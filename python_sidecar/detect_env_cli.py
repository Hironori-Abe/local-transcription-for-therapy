#!/usr/bin/env python3
"""detect_env_cli.py — compute environment detection for LoTT settings display."""

import json
import sys
from typing import Any, Dict, List


def force_utf8_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


def detect_gpu_backend() -> str:
    """Return 'cuda', 'rocm', or 'none'."""
    try:
        import torch  # type: ignore

        if not torch.cuda.is_available():
            return "none"
        if hasattr(torch.version, "hip") and torch.version.hip is not None:
            return "rocm"
        return "cuda"
    except ImportError:
        return "none"


def list_gpu_devices() -> List[Dict[str, Any]]:
    """Enumerate GPU devices visible to the current torch build."""
    devices: List[Dict[str, Any]] = []
    try:
        import torch  # type: ignore

        count = torch.cuda.device_count()
        for i in range(count):
            props = torch.cuda.get_device_properties(i)
            try:
                free_bytes, total_bytes = torch.cuda.mem_get_info(i)
                free_mb = free_bytes // (1024 * 1024)
                total_mb = total_bytes // (1024 * 1024)
            except Exception:
                total_mb = props.total_memory // (1024 * 1024)
                free_mb = total_mb
            is_igpu = total_mb > _IGPU_TOTAL_MB_THRESHOLD
            gcn_arch = ""
            try:
                gcn_arch = getattr(props, "gcnArchName", "").split(":")[0].strip()
            except Exception:
                pass
            devices.append(
                {
                    "index": i,
                    "name": torch.cuda.get_device_name(i),
                    "totalVramMb": total_mb,
                    "freeVramMb": free_mb,
                    "isLikelyIgpu": is_igpu,
                    "gcnArchName": gcn_arch,
                }
            )
    except Exception:
        pass
    return devices


def get_cpu_info() -> Dict[str, Any]:
    """Return basic CPU/RAM info. Available for future use; not shown in UI by default."""
    import os

    info: Dict[str, Any] = {"cores": os.cpu_count() or 0}
    try:
        with open("/proc/meminfo", encoding="ascii") as f:
            lines = f.readlines()
        mem: Dict[str, int] = {}
        for line in lines:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    mem[parts[0].rstrip(":")] = int(parts[1])
                except ValueError:
                    pass
        info["totalRamMb"] = mem.get("MemTotal", 0) // 1024
        info["freeRamMb"] = mem.get("MemAvailable", 0) // 1024
    except Exception:
        pass
    return info


_IGPU_TOTAL_MB_THRESHOLD = 24 * 1024  # 24 GB; iGPU sharing system RAM tends to show more
_LARGE_V3_HF_REPO = "models--Systran--faster-whisper-large-v3"


def _get_hf_hub_cache_root() -> str:
    import os
    if os.environ.get("HF_HUB_CACHE"):
        return os.environ["HF_HUB_CACHE"]
    if os.environ.get("HUGGINGFACE_HUB_CACHE"):
        return os.environ["HUGGINGFACE_HUB_CACHE"]
    if os.environ.get("HF_HOME"):
        return os.path.join(os.environ["HF_HOME"], "hub")
    return os.path.expanduser("~/.cache/huggingface/hub")


def is_large_v3_installed() -> bool:
    """Return True if faster-whisper large-v3 model is fully present in the HuggingFace Hub cache.

    Checks for required model files in snapshots (same logic as Rust setup checks)
    so that a partially-downloaded model directory does not register as installed.
    """
    import os
    snapshots = os.path.join(_get_hf_hub_cache_root(), _LARGE_V3_HF_REPO, "snapshots")
    if not os.path.isdir(snapshots):
        return False
    for revision in os.listdir(snapshots):
        snapshot = os.path.join(snapshots, revision)
        if all(os.path.isfile(os.path.join(snapshot, name)) for name in ("model.bin", "config.json", "tokenizer.json")):
            return True
    return False


def recommend_device(devices: List[Dict[str, Any]]) -> int:
    """Return the best device: dGPU preferred over iGPU when both have >= 3 GB free VRAM."""
    min_free_mb = 3072
    best_dgpu_idx, best_dgpu_free = -1, -1
    best_igpu_idx, best_igpu_free = -1, -1
    for d in devices:
        if d["freeVramMb"] < min_free_mb:
            continue
        if d.get("isLikelyIgpu", False):
            if d["freeVramMb"] > best_igpu_free:
                best_igpu_free, best_igpu_idx = d["freeVramMb"], d["index"]
        else:
            if d["freeVramMb"] > best_dgpu_free:
                best_dgpu_free, best_dgpu_idx = d["freeVramMb"], d["index"]
    return best_dgpu_idx if best_dgpu_idx >= 0 else best_igpu_idx


def main() -> int:
    force_utf8_stdio()
    backend = detect_gpu_backend()
    devices = list_gpu_devices()
    cpu = get_cpu_info()
    recommended = recommend_device(devices)
    result: Dict[str, Any] = {
        "backendType": backend,
        "devices": devices,
        "recommendedIndex": recommended,
        "cpu": cpu,
        "largeV3Installed": is_large_v3_installed(),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
