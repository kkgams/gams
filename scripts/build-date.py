"""Emit the baked UTC app date, or its console startup script."""
import argparse
from datetime import datetime, timezone
import os


def build_date(moment=None):
    moment = moment if moment is not None else datetime.now(timezone.utc)
    if moment.tzinfo is None:
        raise ValueError('Build time must include a timezone')
    return moment.astimezone(timezone.utc).strftime('%Y%m%d')


def validate_date(value):
    if len(value) != 8 or not value.isascii() or not value.isdigit():
        raise ValueError('GAMS_BUILD_DATE must be YYYYMMDD')
    if datetime.strptime(value, '%Y%m%d').strftime('%Y%m%d') != value:
        raise ValueError('GAMS_BUILD_DATE must be a valid YYYYMMDD date')
    return value


def startup_script(value):
    return f'console.log("GAMS release date: {validate_date(value)}");'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', action='store_true')
    args = parser.parse_args()
    value = validate_date(os.environ.get('GAMS_BUILD_DATE', build_date()))
    print(startup_script(value) if args.script else value)
