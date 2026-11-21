#!/usr/bin/env python3
"""Small, dependency-free VPS health reporter for the Organizap superadmin."""

import json
import os
import socket
import subprocess
import time
import urllib.request
from datetime import datetime, timezone


def run(*args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def memory():
    values = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, raw = line.split(":", 1)
            values[key] = int(raw.strip().split()[0]) * 1024
    return {
        "total": values.get("MemTotal", 0),
        "available": values.get("MemAvailable", 0),
        "used": values.get("MemTotal", 0) - values.get("MemAvailable", 0),
        "swap_total": values.get("SwapTotal", 0),
        "swap_free": values.get("SwapFree", 0),
        "swap_used": values.get("SwapTotal", 0) - values.get("SwapFree", 0),
    }


def disk():
    stat = os.statvfs("/")
    total = stat.f_blocks * stat.f_frsize
    available = stat.f_bavail * stat.f_frsize
    return {"total": total, "available": available, "used": total - available}


def network():
    received = 0
    transmitted = 0
    with open("/proc/net/dev", encoding="utf-8") as handle:
        for line in handle.readlines()[2:]:
            name, raw = line.split(":", 1)
            if name.strip() == "lo":
                continue
            parts = raw.split()
            received += int(parts[0])
            transmitted += int(parts[8])
    return {"received": received, "transmitted": transmitted}


def docker():
    containers = []
    output = run("docker", "ps", "--format", "{{.Names}}|{{.Image}}|{{.Status}}")
    for line in output.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            containers.append({"name": parts[0], "image": parts[1], "status": parts[2]})
    usage = []
    output = run("docker", "system", "df", "--format", "{{json .}}")
    for line in output.splitlines():
        try:
            usage.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return {"running": len(containers), "containers": containers, "usage": usage}


def main():
    url = os.environ["REPORT_URL"]
    secret = os.environ["REPORT_SECRET"]
    load = os.getloadavg()
    payload = {
        "source": "organizap-vps",
        "hostname": socket.gethostname(),
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "cpuCores": os.cpu_count() or 1,
            "load1": load[0],
            "load5": load[1],
            "load15": load[2],
            "uptimeSeconds": int(float(open("/proc/uptime", encoding="utf-8").read().split()[0])),
            "memory": memory(),
            "disk": disk(),
            "network": network(),
            "docker": docker(),
        },
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + secret,
            "Content-Type": "application/json",
            "User-Agent": "organizap-infra-reporter/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status >= 300:
            raise RuntimeError("report failed: %s" % response.status)


if __name__ == "__main__":
    main()

