"""App build-date formatting and baked JavaScript behavior."""
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/build-date.py'
spec = importlib.util.spec_from_file_location('build_date', SCRIPT)
dates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dates)


class BuildDateTests(unittest.TestCase):
    def test_format_and_utc_day_boundary(self):
        self.assertEqual(dates.build_date(datetime(2026, 12, 31, tzinfo=timezone.utc)), '20261231')
        self.assertEqual(dates.build_date(datetime(2027, 1, 1, 1, tzinfo=timezone(timedelta(hours=2)))), '20261231')
        with self.assertRaisesRegex(ValueError, 'timezone'):
            dates.build_date(datetime(2026, 12, 31))

    def test_rejects_invalid_dates_and_script_injection(self):
        for value in ('20260229', '20261301', '2026011', '2026-01-01', '', '２０２６１２３１', '20261231");alert(1)'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                dates.startup_script(value)
        self.assertEqual(dates.validate_date('20240229'), '20240229')

    def test_generated_script_logs_once_and_does_not_read_the_runtime_clock(self):
        script = dates.startup_script('20261231')
        self.assertNotIn('Date', script)
        harness = '''
import vm from 'node:vm';
const calls=[];
vm.runInNewContext(process.argv[1], {console:{log:(...args)=>calls.push(args)}, Date:class{constructor(){throw Error('runtime clock read')}}});
process.stdout.write(JSON.stringify(calls));
'''
        result = subprocess.check_output(['node', '--input-type=module', '-e', harness, script], text=True)
        self.assertEqual(json.loads(result), [['GAMS release date: 20261231']])

    def test_cli_date_and_script_share_the_baked_value(self):
        env = {**os.environ, 'GAMS_BUILD_DATE': '20261231'}
        self.assertEqual(subprocess.check_output(['python3', str(SCRIPT)], env=env, text=True), '20261231\n')
        self.assertEqual(subprocess.check_output(['python3', str(SCRIPT), '--script'], env=env, text=True),
                         'console.log("GAMS release date: 20261231");\n')


if __name__ == '__main__':
    unittest.main()
