import resource, subprocess, sys, time
out, err = sys.argv[1], sys.argv[2]
t = time.monotonic()
with open(out, "wb") as o, open(err, "wb") as e:
    rc = subprocess.run(sys.argv[3:], stdout=o, stderr=e).returncode
dt = time.monotonic() - t
ru = resource.getrusage(resource.RUSAGE_CHILDREN)
print(f"exit={rc} elapsed={dt:.1f}s maxrss={ru.ru_maxrss/1024:.0f}MiB")
