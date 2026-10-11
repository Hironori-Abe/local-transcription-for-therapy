//! Process-local Linux crash protection. No sysctl, service or machine-wide settings.
//!
//! RLIMIT_CORE alone does not stop a piped collector such as Apport. Disable dumps
//! for this process, and exclude all ordinary memory mappings from any dumps of
//! children (whisper, NeMo, ffmpeg and WebKit). Unlike dumpability, the memory
//! filter survives both fork and exec, including statically linked executables.
//! Registers and process metadata can still be collected from exec'd children;
//! this does not claim to disable the OS's crash collector itself.

use std::{fs, io, path::Path};

const CORE_FILTER: &str = "/proc/self/coredump_filter";

pub(crate) fn configure() -> io::Result<()> {
    let limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: setrlimit reads the initialized structure for the calling process.
    if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
        return Err(io::Error::last_os_error());
    }

    // Do this before PR_SET_DUMPABLE: making /proc/self root-owned removes write
    // access to coredump_filter. Repeated configuration must not re-enable dumps.
    exclude_memory(Path::new(CORE_FILTER))?;

    // SAFETY: these prctl operations take scalar arguments only.
    if unsafe {
        libc::prctl(
            libc::PR_SET_DUMPABLE,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    match unsafe {
        libc::prctl(
            libc::PR_GET_DUMPABLE,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
        )
    } {
        0 => Ok(()),
        -1 => Err(io::Error::last_os_error()),
        _ => Err(io::Error::other("core dump protection was not applied")),
    }
}

fn memory_is_excluded(path: &Path) -> io::Result<bool> {
    let value = fs::read_to_string(path)?;
    let mask = u64::from_str_radix(value.trim(), 16)
        .map_err(|_| io::Error::other("invalid core dump memory filter"))?;
    Ok(mask == 0)
}

fn exclude_memory(path: &Path) -> io::Result<()> {
    if !memory_is_excluded(path)? {
        fs::write(path, b"0\n")?;
    }
    if memory_is_excluded(path)? {
        Ok(())
    } else {
        Err(io::Error::other(
            "core dump memory exclusion was not applied",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    const PROBE_MODE: &str = "LOTT_CRASH_PROTECTION_TEST_MODE";
    const PROBE_TEST: &str = "linux_crash_protection::tests::process_probe";

    fn probe(mode: &str) -> std::process::Output {
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", PROBE_TEST, "--nocapture"])
            .env(PROBE_MODE, mode)
            .output()
            .unwrap()
    }

    fn assert_probe_succeeded(output: std::process::Output) {
        assert!(
            output.status.success(),
            "probe failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("PROTECTION_VERIFIED"));
    }

    #[test]
    fn protects_process_and_exec_children_without_modifying_test_runner() {
        // PR_SET_DUMPABLE and the hard rlimit are process-wide and irreversible
        // here. Exercise them in a subprocess instead of the parallel test runner.
        assert_probe_succeeded(probe("parent"));
    }

    #[test]
    fn unavailable_filter_is_an_error() {
        let dir = std::env::temp_dir().join(format!("lott-no-core-filter-{}", std::process::id()));
        assert!(exclude_memory(&dir.join("missing/filter")).is_err());
    }

    #[test]
    fn process_probe() {
        let Ok(mode) = std::env::var(PROBE_MODE) else {
            return;
        };
        if mode == "parent" {
            configure().unwrap();
            configure().expect("repeated configuration must work without restoring dumpability");
            assert_eq!(
                unsafe {
                    libc::prctl(
                        libc::PR_GET_DUMPABLE,
                        0 as libc::c_ulong,
                        0 as libc::c_ulong,
                        0 as libc::c_ulong,
                        0 as libc::c_ulong,
                    )
                },
                0
            );
            assert_probe_succeeded(probe("child"));
        } else {
            assert_eq!(mode, "child");
            // exec resets dumpability to 1. The other two protections must remain.
            assert_eq!(
                unsafe {
                    libc::prctl(
                        libc::PR_GET_DUMPABLE,
                        0 as libc::c_ulong,
                        0 as libc::c_ulong,
                        0 as libc::c_ulong,
                        0 as libc::c_ulong,
                    )
                },
                1
            );
            let output = Command::new("/bin/sh")
                .args(["-c", "cat /proc/self/coredump_filter; ulimit -c"])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8_lossy(&output.stdout).trim(),
                "00000000\n0"
            );
        }
        let mut limit = libc::rlimit {
            rlim_cur: 1,
            rlim_max: 1,
        };
        assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut limit) }, 0);
        assert_eq!((limit.rlim_cur, limit.rlim_max), (0, 0));
        assert!(memory_is_excluded(Path::new(CORE_FILTER)).unwrap());
        println!("PROTECTION_VERIFIED");
    }
}
