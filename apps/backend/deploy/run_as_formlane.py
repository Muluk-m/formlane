#!/usr/bin/env python3
"""Run a deployment command as the service user with a private environment file."""

import argparse
import json
import os
import pwd
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", default="/etc/formlane/backend-stage.env")
    parser.add_argument("--cwd", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if os.geteuid() != 0 or not args.command:
        parser.error("Run as root and supply an executable command.")
    command = args.command[1:] if args.command[0] == "--" else args.command
    if not command:
        parser.error("Supply an executable command.")
    account = pwd.getpwnam("formlane")
    environment = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": "/var/lib/formlane/python",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    for line in Path(args.environment).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator:
            raise ValueError("Invalid managed environment entry.")
        environment[key] = json.loads(value)
    os.chdir(args.cwd)
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.umask(0o077)
    os.execvpe(command[0], command, environment)


if __name__ == "__main__":
    main()
