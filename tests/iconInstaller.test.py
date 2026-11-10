"""Execute the bundled Lua installer against a memory filesystem (requires Lupa)."""
import struct
import unittest
from pathlib import Path

from lupa import LuaRuntime

INSTALLER = Path(__file__).resolve().parents[1] / 'public/pack/icon_pack.lua'
INDEX = b'/data/chaos/icons/index.txt'
PACK = b'/package/pack.bin'
OLD_INDEX = b'01 Existing    \n' + b' ' * 112

STUB = rb'''
FILES = {}
MAX_READ = 0
local function object(props)
  return {
    clear_flag = function() end, add_flag = function() end,
    onClicked = function(self, callback) CLICK = callback end,
    set = function(self, changes) STATUS = changes.text end,
  }
end
local lvgl = {
  Object = function(parent, props) return object(props) end,
  Label = function(parent, props) return object(props) end,
  HOR_RES = function() return 336 end, VER_RES = function() return 480 end,
  OPA = function(n) return n end, Font = function() return 1 end,
  FLAG = { SCROLLABLE = 1, CLICKABLE = 2, EVENT_BUBBLE = 3 },
  ALIGN = { CENTER = 0 },
  Timer = function(props)
    TIMER = { paused = true, callback = props.cb,
      pause = function(self) self.paused = true end,
      resume = function(self) self.paused = false end,
      ready = function() end }
    return TIMER
  end,
}
require = function(name) assert(name == 'lvgl'); return lvgl end
os.execute = function() return true end
os.remove = function(path) FILES[path] = nil; return true end
os.rename = function(src, dst)
  if FAIL_RENAME then return nil, 'rename failure' end
  FILES[dst], FILES[src] = FILES[src], nil
  return true
end
SCRIPT_PATH = '/package/'
io.open = function(path, mode)
  if mode == 'rb' and not FILES[path] then return nil, 'missing' end
  if mode == 'wb' then FILES[path] = '' end
  local f = { pos = 1 }
  f.read = function(self, n)
    assert(type(n) == 'number', 'unbounded read forbidden')
    MAX_READ = math.max(MAX_READ, n)
    if SHORT_READ then n = math.min(n, 113) end
    local raw = FILES[path] or ''
    if self.pos > #raw then return nil end
    local out = raw:sub(self.pos, self.pos + n - 1)
    self.pos = self.pos + #out
    return out
  end
  f.write = function(self, block)
    if FAIL_WRITE and path:match('/%d%d/') then return nil, 'disk full' end
    if FAIL_INDEX and path:match('index.txt.tmp$') then return nil, 'disk full' end
    if CORRUPT and path:match('/%d%d/') and #block > 0 then block = string.char((block:byte(1) + 1) % 256) .. block:sub(2) end
    local raw = FILES[path]
    FILES[path] = raw:sub(1, self.pos - 1) .. block .. raw:sub(self.pos + #block)
    self.pos = self.pos + #block
    return self
  end
  f.close = function(self)
    if FAIL_CLOSE and mode == 'wb' and path:match('/%d%d/') then return nil, 'close failure' end
    return true
  end
  return f
end
'''


def cipk(entries):
    return b'CIPK' + struct.pack('<I', len(entries)) + b''.join(
        struct.pack('<IB', len(data), len(name)) + name + data for name, data in entries
    )


class InstallerTest(unittest.TestCase):
    def run_installer(self, data, index=OLD_INDEX, **flags):
        lua = LuaRuntime(encoding=None)
        lua.execute(STUB)
        g = lua.globals()
        g.FILES[PACK], g.FILES[INDEX] = data, index
        for name, value in flags.items():
            g[name.encode()] = value
        script = INSTALLER.read_bytes().replace(b'__PACK_NAME__', b'TestPack').replace(b'__PACK_TITLE__', b'Icon Pack')
        lua.execute(script)
        lua.execute(b'CLICK(); for i = 1, 10000 do if TIMER.paused then break end; TIMER.callback(TIMER) end; assert(TIMER.paused)')
        self.assertLessEqual(g.MAX_READ, 65536)
        return g

    def test_legacy_static_and_large_animation(self):
        entries = [(b'alarm.bin', b'x' * 50000), (b'alarm_anim.bin', b'y' * 700000), (b'animations.bin', b'z' * 20)]
        result = self.run_installer(cipk(entries))
        self.assertIn('已投递'.encode(), result.STATUS)
        self.assertEqual(len(result.FILES[INDEX]), 128)
        for name, data in entries:
            self.assertEqual(result.FILES[b'/data/chaos/icons/02/' + name], data)

    def test_short_reads(self):
        data = b'abcdef' * 12000
        result = self.run_installer(cipk([(b'alarm.bin', data)]), SHORT_READ=True)
        self.assertIn('已投递'.encode(), result.STATUS)
        self.assertEqual(result.FILES[b'/data/chaos/icons/02/alarm.bin'], data)

    def assert_rejected(self, data, **flags):
        result = self.run_installer(data, **flags)
        self.assertNotIn('已投递'.encode(), result.STATUS)
        self.assertEqual(result.FILES[INDEX], OLD_INDEX)

    def test_truncation_and_trailing_bytes(self):
        good = cipk([(b'alarm.bin', b'abc')])
        self.assert_rejected(good[:-1])
        self.assert_rejected(good + b'extra')

    def test_duplicate_and_path_traversal(self):
        self.assert_rejected(cipk([(b'alarm.bin', b'x'), (b'alarm.bin', b'y')]))
        self.assert_rejected(cipk([(b'../alarm.bin', b'x')]))

    def test_static_and_animation_limits(self):
        self.assert_rejected(cipk([(b'alarm.bin', b'x' * 524289)]))
        self.assert_rejected(cipk([(b'alarm_anim.bin', b'x' * 1048577)]))

    def test_full_index_keeps_existing_packages(self):
        index = b''.join(f'{i:02d} Package{i:<5}\n'.encode() for i in range(1, 9))
        self.assertEqual(len(index), 128)
        result = self.run_installer(cipk([(b'alarm.bin', b'x')]), index=index)
        self.assertEqual(result.FILES[INDEX], index)
        self.assertIn('已满'.encode(), result.STATUS)
        short_read = self.run_installer(cipk([(b'alarm.bin', b'x')]), index=index, SHORT_READ=True)
        self.assertEqual(short_read.FILES[INDEX], index)
        self.assertIn('已满'.encode(), short_read.STATUS)

    def test_same_name_reuses_slot(self):
        index = b'01 TestPack    \n' + b' ' * 112
        result = self.run_installer(cipk([(b'alarm.bin', b'x')]), index=index)
        self.assertEqual(result.FILES[INDEX], index)
        self.assertEqual(result.FILES[b'/data/chaos/icons/01/alarm.bin'], b'x')

    def test_write_close_corruption_and_commit_failures_preserve_index(self):
        for flag in ['FAIL_WRITE', 'FAIL_CLOSE', 'CORRUPT', 'FAIL_INDEX', 'FAIL_RENAME']:
            with self.subTest(flag=flag):
                self.assert_rejected(cipk([(b'alarm.bin', b'abcdef' * 12000)]), **{flag: True})


if __name__ == '__main__':
    unittest.main()
