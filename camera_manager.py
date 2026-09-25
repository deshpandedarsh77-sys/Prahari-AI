"""
PRAHARI-AI Multi-Camera & Source Manager
Manages simultaneous video streams (RTSP, local video files, USB/integrated webcams).
Maintains isolated RTSPStreamReader instances per camera with independent tracking,
intrusion boundaries, ANPR, suspicious activity, and night detection states.
"""

import os
import sys
import time
import json
import logging
import psutil
import torch
import cv2
from rtsp_stream import RTSPStreamReader

logger = logging.getLogger("CameraManager")

def _load_camera_config() -> list:
    """Loads camera definitions from PRAHARI_CAMERAS as a JSON array."""
    raw_config = os.getenv("PRAHARI_CAMERAS", "[]").strip()
    if not raw_config:
        return []
    try:
        cameras = json.loads(raw_config)
        if not isinstance(cameras, list):
            raise ValueError("PRAHARI_CAMERAS must be a JSON array")
        return cameras
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error(f"Invalid PRAHARI_CAMERAS configuration: {exc}")
        return []


def _placeholder_camera(camera_id: str, name: str) -> dict:
    """Return a disabled camera definition that is safe for startup but explicit to the operator."""
    return {
        "id": camera_id,
        "name": name,
        "type": "manual",
        "url": "",
        "enabled": False,
        "status": "offline",
        "reason": "No live stream configured. Set PRAHARI_CAMERAS or connect a webcam from the admin panel.",
    }


def _load_default_camera_list() -> list:
    """Resolve a safe default camera list from explicit env config or local webcam fallbacks.

    We intentionally avoid treating human-readable zone names like "Border Restricted Zone"
    as RTSP URLs. If the system is not configured with an actual stream, we keep cameras in a
    disabled/manual state instead of probing webcam indexes 0..N at startup.
    """
    env_cameras = _load_camera_config()
    if env_cameras:
        return env_cameras

    try:
        from database import db_manager
        db_cameras = db_manager.get_admin_cameras_config()
        if db_cameras:
            safe_rows = []
            for row in db_cameras:
                camera_id = row.get("camera_id") or row.get("id") or f"CAM-{len(safe_rows) + 1:02d}"
                name = row.get("name", camera_id)
                source_url = row.get("source_url") or row.get("rtsp_url") or row.get("url") or row.get("stream_url")
                if source_url is not None and str(source_url).strip():
                    safe_rows.append({
                        "id": camera_id,
                        "name": name,
                        "type": "rtsp" if str(source_url).lower().startswith("rtsp://") else "webcam",
                        "url": source_url,
                        "enabled": True,
                    })
                else:
                    safe_rows.append(_placeholder_camera(camera_id, name))
            if safe_rows:
                return safe_rows
    except Exception:
        pass

    return [
        _placeholder_camera("CAM-01", "Border Post Alpha"),
        _placeholder_camera("CAM-02", "Night Surveillance Bravo"),
        _placeholder_camera("CAM-03", "Perimeter Activity Charlie"),
        _placeholder_camera("CAM-04", "Urban Facility Delta"),
    ]


# Configure IP cameras and USB webcams with PRAHARI_CAMERAS, for example:
# [{"id":"CAM-01","name":"Gate","type":"rtsp","url":"rtsp://user:password@192.168.1.20:554/stream1","enabled":true},
#  {"id":"CAM-02","name":"Lobby Webcam","type":"webcam","url":0,"enabled":true},
#  {"id":"CAM-03","name":"Desk Webcam","type":"webcam","url":1,"enabled":true}]
DEFAULT_CAMERAS = _load_default_camera_list()

# Backward compatibility alias
CAMERAS = DEFAULT_CAMERAS


class CameraManager:
    """Central manager for all active surveillance camera readers."""

    def __init__(self, camera_configs: list = None):
        self.configs = camera_configs or DEFAULT_CAMERAS
        self.readers = {}  # camera_id -> RTSPStreamReader
        self.webcam_reader = None

        for cam in self.configs:
            source_value = cam.get("url")
            if not cam.get("enabled", True):
                logger.info(f"Camera {cam['id']} ({cam.get('name', '')}) is disabled, skipping.")
                continue
            if cam.get("type") in {"manual", "placeholder", "disabled"} or (source_value is None or str(source_value).strip() == ""):
                logger.info(f"Camera {cam['id']} ({cam.get('name', '')}) has no configured stream, leaving it offline until manually connected.")
                continue

            try:
                # Check if an active zone configuration exists in SQLite for this camera
                initial_line_ratio = cam.get("line_y_ratio", 0.70)
                cam_zones = []
                try:
                    from database import db_manager
                    cam_zones = db_manager.list_admin_zones(camera_id=cam["id"], is_enabled=1)
                    if cam_zones and cam_zones[0].get("fence_ratio") is not None:
                        initial_line_ratio = float(cam_zones[0]["fence_ratio"])
                        logger.info(f"Loaded persistent zone fence ratio for [{cam['id']}]: {initial_line_ratio}")
                except Exception:
                    pass

                reader = RTSPStreamReader(
                    rtsp_url=cam["url"],
                    camera_id=cam["id"],
                    camera_name=cam.get("name", cam["id"]),
                    source_type=cam.get("type", "video_file"),
                    line_y_ratio=initial_line_ratio,
                    fps_log_interval=4.0
                )
                if cam_zones:
                    zone = cam_zones[0]
                    reader.roi_x1 = zone.get("roi_x1")
                    reader.roi_y1 = zone.get("roi_y1")
                    reader.roi_x2 = zone.get("roi_x2")
                    reader.roi_y2 = zone.get("roi_y2")
                self.readers[cam["id"]] = reader
                logger.info(f"Registered Camera [{cam['id']}] ({cam.get('name', '')}) -> Source: {cam['url']}")
            except Exception as e:
                logger.error(f"Error registering camera {cam.get('id')}: {e}")

    def start_all(self):
        """Starts all configured camera readers."""
        for cam_id, reader in self.readers.items():
            try:
                reader.start()
                logger.info(f"Started camera pipeline: {cam_id}")
            except Exception as e:
                logger.error(f"Failed to start camera {cam_id}: {e}")

    def stop_all(self):
        """Stops all active camera readers."""
        for cam_id, reader in self.readers.items():
            try:
                reader.stop()
                logger.info(f"Stopped camera pipeline: {cam_id}")
            except Exception as e:
                logger.error(f"Error stopping camera {cam_id}: {e}")

    def reconfigure_profile(self):
        """Restart camera workers so runtime profile settings take effect."""
        self.stop_all()
        for reader in self.readers.values():
            reader.start()
        logger.info("Camera pipelines restarted after runtime profile change")

        if self.webcam_reader:
            try:
                self.webcam_reader.stop()
            except Exception:
                pass
            self.webcam_reader = None

    def start_camera(self, camera_id: str) -> bool:
        """Starts an individual camera if present and not already running."""
        if camera_id in self.readers:
            self.readers[camera_id].start()
            return True
        return False

    def stop_camera(self, camera_id: str) -> bool:
        """Stops an individual camera reader."""
        if camera_id in self.readers:
            self.readers[camera_id].stop()
            return True
        return False

    def get_reader(self, camera_id: str = None) -> RTSPStreamReader:
        """Returns specific camera reader. Defaults to CAM-01 or first available."""
        if camera_id:
            if camera_id in self.readers:
                return self.readers[camera_id]
            if camera_id == "CAM-WEBCAM" and self.webcam_reader:
                return self.webcam_reader

        # Default fallback
        if "CAM-01" in self.readers:
            return self.readers["CAM-01"]
        if self.readers:
            return next(iter(self.readers.values()))
        return None

    def get_all_readers(self) -> dict:
        """Returns dictionary of all active readers."""
        all_r = dict(self.readers)
        if self.webcam_reader:
            all_r["CAM-WEBCAM"] = self.webcam_reader
        return all_r

    def get_all_status(self) -> list:
        """Returns status list for all configured and dynamic cameras."""
        statuses = []
        for cam_id, reader in self.readers.items():
            st = reader.get_status()
            statuses.append(st)

        if self.webcam_reader:
            statuses.append(self.webcam_reader.get_status())

        return statuses

    def get_camera_list(self) -> list:
        """Returns formatted list of cameras for API and UI rendering."""
        result = []
        for cam in self.configs:
            cam_id = cam["id"]
            cam_info = {
                "id": cam_id,
                "name": cam.get("name", cam_id),
                "url": str(cam.get("url", "")),
                "type": cam.get("type", "video_file"),
                "enabled": cam.get("enabled", True),
                "active": cam_id in self.readers and self.readers[cam_id].running,
            }
            if cam_id in self.readers:
                reader = self.readers[cam_id]
                cam_info["connected"] = reader.is_connected
                cam_info["status"] = reader.status
                cam_info["fps"] = reader.current_fps
                cam_info["capture_fps"] = reader.capture_fps
                cam_info["night_mode"] = reader.is_night_mode
                cam_info["night_state"] = reader.night_state_str
                cam_info["brightness"] = reader.current_brightness
                cam_info["face_count"] = reader.face_count
                cam_info["people_count"] = reader.people_count
                cam_info["vehicle_count"] = reader.vehicle_count
                cam_info["total_objects"] = reader.total_objects
                cam_info["detected_objects"] = {
                    "people_count": reader.people_count,
                    "vehicle_count": reader.vehicle_count,
                    "total_objects": reader.total_objects
                }
                cam_info["session_alerts"] = reader.session_alerts_count
            result.append(cam_info)

        if self.webcam_reader:
            w_st = self.webcam_reader.get_status()
            result.append({
                "id": "CAM-WEBCAM",
                "name": "Live Integrated/USB Webcam",
                "url": "0",
                "type": "webcam",
                "enabled": True,
                "active": self.webcam_reader.running,
                "connected": self.webcam_reader.is_connected,
                "status": self.webcam_reader.status,
                "fps": self.webcam_reader.current_fps,
                "capture_fps": self.webcam_reader.capture_fps,
                "night_mode": self.webcam_reader.is_night_mode,
                "night_state": self.webcam_reader.night_state_str,
                "brightness": self.webcam_reader.current_brightness,
                "face_count": self.webcam_reader.face_count,
                "people_count": self.webcam_reader.people_count,
                "vehicle_count": self.webcam_reader.vehicle_count,
                "total_objects": self.webcam_reader.total_objects,
                "detected_objects": {
                    "people_count": self.webcam_reader.people_count,
                    "vehicle_count": self.webcam_reader.vehicle_count,
                    "total_objects": self.webcam_reader.total_objects
                },
                "session_alerts": self.webcam_reader.session_alerts_count
            })

        return result

    def get_aggregate_status(self) -> dict:
        """Computes system-wide aggregate telemetry including GPU, CPU, AI throughput, and incident metrics."""
        all_r = self.get_all_readers()
        total_ai_fps = sum(r.current_fps for r in all_r.values())
        total_capture_fps = sum(r.capture_fps for r in all_r.values())
        total_people = sum(r.people_count for r in all_r.values())
        total_vehicles = sum(r.vehicle_count for r in all_r.values())
        total_session_alerts = sum(r.session_alerts_count for r in all_r.values())
        total_session_anpr = sum(r.session_anpr_count for r in all_r.values())
        total_session_suspicious = sum(r.session_suspicious_count for r in all_r.values())
        total_session_night = sum(r.session_night_count for r in all_r.values())

        # GPU metrics via pynvml (real hardware telemetry) / PyTorch CUDA
        gpu_info = {
            "available": False,
            "name": "CPU Fallback",
            "device_name": "CPU Fallback",
            "gpu_util_pct": None,
            "vram_used_mb": 0,
            "vram_total_mb": 0,
            "vram_pct": None
        }
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            gpu_name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(gpu_name, bytes):
                gpu_name = gpu_name.decode("utf-8")
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_used = round(mem.used / (1024 * 1024), 1)
            vram_total = round(mem.total / (1024 * 1024), 1)
            vram_pct = round((mem.used / mem.total) * 100.0, 1) if mem.total > 0 else 0.0
            gpu_info = {
                "available": True,
                "name": gpu_name,
                "device_name": gpu_name,
                "gpu_util_pct": int(util.gpu),
                "vram_used_mb": vram_used,
                "vram_total_mb": vram_total,
                "vram_pct": vram_pct
            }
        except Exception:
            if torch.cuda.is_available():
                try:
                    dev = 0
                    gpu_name = torch.cuda.get_device_name(dev)
                    total_vram = torch.cuda.get_device_properties(dev).total_memory / (1024 * 1024)
                    allocated = torch.cuda.memory_allocated(dev) / (1024 * 1024)
                    reserved = torch.cuda.memory_reserved(dev) / (1024 * 1024)
                    used_vram = max(allocated, reserved)
                    vram_pct = (used_vram / total_vram * 100.0) if total_vram > 0 else 0.0
                    gpu_info = {
                        "available": True,
                        "name": gpu_name,
                        "device_name": gpu_name,
                        "gpu_util_pct": None,
                        "vram_used_mb": round(used_vram, 1),
                        "vram_total_mb": round(total_vram, 1),
                        "vram_pct": round(vram_pct, 1)
                    }
                except Exception:
                    pass

        # CPU & RAM
        cpu_pct = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory()

        # Face count only from currently connected cameras
        total_faces = sum(getattr(r, "face_count", 0) for r in all_r.values() if getattr(r, "is_connected", False))

        # Persisted database metrics (cached with 1.0s throttle for efficiency)
        now = time.time()
        if not hasattr(self, "_cached_db_incident_summary") or (now - getattr(self, "_last_db_summary_time", 0)) > 1.0:
            try:
                from database import db_manager
                self._cached_db_incident_summary = db_manager.count_admin_incidents_summary()
                self._cached_verified_anpr = db_manager.get_verified_anpr_count()
                self._cached_db_healthy = db_manager.is_healthy()
                self._last_db_summary_time = now
            except Exception as e:
                logger.error(f"Error refreshing database aggregate metrics: {e}")
                self._cached_db_incident_summary = {"open": 0, "active_critical": 0, "active_high": 0, "active_medium": 0}
                self._cached_verified_anpr = 0
                self._cached_db_healthy = False

        inc_summary = getattr(self, "_cached_db_incident_summary", {})
        active_incidents = inc_summary.get("open", 0)
        active_critical = inc_summary.get("active_critical", 0)
        active_high = inc_summary.get("active_high", 0)
        active_medium = inc_summary.get("active_medium", 0)
        verified_anpr = getattr(self, "_cached_verified_anpr", 0)
        db_healthy = getattr(self, "_cached_db_healthy", True)

        # Threat Status derivation from active unresolved incidents
        if active_critical > 0:
            threat_level = "CRITICAL"
            threat_score = 25
        elif active_high > 0:
            threat_level = "HIGH"
            threat_score = 15
        elif active_medium > 0:
            threat_level = "ELEVATED"
            threat_score = 8
        else:
            threat_level = "NORMAL"
            threat_score = 0

        # System Health derivation: all cameras connected + AI inference active + DB online
        active_cams = sum(1 for r in all_r.values() if r.is_connected)
        total_cams = len(all_r)
        all_cams_online = (active_cams >= total_cams and total_cams > 0)
        ai_healthy = (total_ai_fps > 0.0)

        if not db_healthy or active_cams == 0:
            system_health = "OFFLINE"
            system_health_desc = "Critical subsystem failure"
        elif all_cams_online and ai_healthy:
            system_health = "OPTIMAL"
            system_health_desc = "All pipelines nominal"
        else:
            system_health = "DEGRADED"
            system_health_desc = f"{total_cams - active_cams} channel(s) offline" if not all_cams_online else "AI inference degraded"

        return {
            "total_cameras": total_cams,
            "active_cameras": active_cams,
            "aggregate_ai_fps": round(total_ai_fps, 1),
            "aggregate_capture_fps": round(total_capture_fps, 1),
            "total_people_detected": total_people,
            "total_vehicles_detected": total_vehicles,
            "total_live_faces": total_faces,
            "total_session_alerts": total_session_alerts,
            "total_session_anpr": total_session_anpr,
            "total_session_suspicious": total_session_suspicious,
            "total_session_night": total_session_night,
            "gpu": gpu_info,
            "cpu_percent": cpu_pct,
            "ram_used_gb": round((ram.total - ram.available) / (1024**3), 2),
            "ram_total_gb": round(ram.total / (1024**3), 2),
            "ram_percent": ram.percent,
            "active_security_incidents": active_incidents,
            "active_critical_incidents": active_critical,
            "active_incidents_count": active_incidents,
            "active_critical_count": active_critical,
            "verified_anpr_reads": verified_anpr,
            "threat_level": threat_level,
            "threat_score": threat_score,
            "system_health": system_health,
            "system_health_desc": system_health_desc,
            "server_timestamp": now,
        }

    def enable_webcam(self, device_index: int = 0, camera_id: str = "CAM-WEBCAM") -> dict:
        """Starts live webcam input as a named camera."""
        if self.webcam_reader and self.webcam_reader.running and camera_id == "CAM-WEBCAM":
            return {"status": "already_running", "camera_id": camera_id}

        try:
            reader = RTSPStreamReader(
                rtsp_url=int(device_index),
                camera_id=camera_id,
                camera_name=f"Live Integrated/USB Webcam ({camera_id})",
                source_type="webcam",
                fps_log_interval=4.0
            )
            self.readers[camera_id] = reader
            self.configs = [cam for cam in self.configs if cam.get("id") != camera_id]
            self.configs.append({
                "id": camera_id,
                "name": f"Live Integrated/USB Webcam ({camera_id})",
                "type": "webcam",
                "url": int(device_index),
                "enabled": True,
            })
            self.webcam_reader = reader
            reader.start()
            logger.info(f"Webcam {camera_id} started on device index {device_index}")
            return {"status": "started", "camera_id": camera_id}
        except Exception as e:
            logger.error(f"Failed to start webcam: {e}")
            return {"status": "error", "error": str(e)}

    def disable_webcam(self) -> dict:
        """Stops and removes CAM-WEBCAM."""
        if self.webcam_reader:
            try:
                self.webcam_reader.stop()
            except Exception as e:
                logger.error(f"Error stopping webcam: {e}")
            self.webcam_reader = None
            return {"status": "stopped", "camera_id": "CAM-WEBCAM"}
        return {"status": "not_active"}

    @staticmethod
    def _probe_capture(source, use_dshow: bool = True):
        """Open a capture object and return it if valid."""
        logging_api = getattr(getattr(cv2, "utils", None), "logging", None)
        previous_log_level = None
        try:
            if logging_api:
                previous_log_level = logging_api.getLogLevel()
                logging_api.setLogLevel(logging_api.LOG_LEVEL_ERROR)
            if isinstance(source, int):
                cap = cv2.VideoCapture(source, cv2.CAP_DSHOW) if use_dshow and sys.platform == "win32" else cv2.VideoCapture(source)
            else:
                cap = cv2.VideoCapture(str(source))
            if cap.isOpened():
                ret, _ = cap.read()
                if ret:
                    return cap
            cap.release()
        except Exception:
            pass
        finally:
            if logging_api and previous_log_level is not None:
                logging_api.setLogLevel(previous_log_level)
        return None

    @staticmethod
    def _load_rtsp_candidates() -> list:
        """Load RTSP candidates from PRAHARI_RTSP_CANDIDATES or configured camera list."""
        raw = os.getenv("PRAHARI_RTSP_CANDIDATES", "").strip()
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed if str(item).strip()]
                if isinstance(parsed, str):
                    return [parsed]
            except Exception:
                return [item.strip() for item in raw.split(",") if item.strip()]

        candidates = []
        for cam in DEFAULT_CAMERAS:
            url = str(cam.get("url", "")).strip()
            if cam.get("type") == "rtsp" and url and url not in candidates:
                candidates.append(url)
        return candidates

    def discover_video_sources(self, max_webcams: int = 6, rtsp_candidates: list = None) -> list:
        """Probe the system for working webcams/CCTV sources and return only valid inputs."""
        discovered = []
        seen = set()

        for i in range(max_webcams):
            active_reader = next(
                (
                    reader for reader in self.readers.values()
                    if reader.source_type == "webcam"
                    and str(reader.rtsp_url).isdigit()
                    and int(reader.rtsp_url) == i
                    and reader.running
                ),
                None,
            )
            if active_reader:
                device_id = active_reader.camera_id
                discovered.append({
                    "id": device_id,
                    "name": active_reader.name,
                    "type": "webcam",
                    "index": i,
                    "url": i,
                    "status": "working",
                    "connected": True,
                    "device": "webcam",
                })
                seen.add(("webcam", i))
                continue

            cap = self._probe_capture(i)
            if cap is None:
                continue
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            device_id = f"CAM-USB-{i}"
            device = {
                "id": device_id,
                "name": f"USB Webcam #{i} ({w}x{h})",
                "type": "webcam",
                "index": i,
                "url": i,
                "status": "working",
                "connected": device_id in self.readers and self.readers[device_id].is_connected,
                "device": "webcam",
            }
            discovered.append(device)
            seen.add(("webcam", i))
            cap.release()

        # Report active webcam readers even when their index is outside the probe
        # range or the operating system temporarily locks the device for capture.
        for reader in self.readers.values():
            if reader.source_type != "webcam":
                continue
            try:
                device_index = int(reader.rtsp_url)
            except (TypeError, ValueError):
                continue
            if ("webcam", device_index) in seen:
                continue
            discovered.append({
                "id": reader.camera_id,
                "name": reader.name,
                "type": "webcam",
                "index": device_index,
                "url": device_index,
                "status": "working" if reader.is_connected else "available",
                "connected": bool(reader.is_connected),
                "device": "webcam",
            })
            seen.add(("webcam", device_index))

        candidate_urls = rtsp_candidates if rtsp_candidates is not None else self._load_rtsp_candidates()
        for idx, url in enumerate(candidate_urls):
            if not url:
                continue
            key = ("rtsp", str(url))
            if key in seen:
                continue
            cap = self._probe_capture(url)
            if cap is None:
                continue
            cap.release()
            device_id = f"CAM-RTSP-{idx + 1}"
            discovered.append({
                "id": device_id,
                "name": f"CCTV Camera {idx + 1}",
                "type": "rtsp",
                "index": idx,
                "url": str(url),
                "status": "working",
                "connected": device_id in self.readers and self.readers[device_id].is_connected,
                "device": "rtsp",
            })
            seen.add(key)

        return discovered

    def connect_detected_camera(self, device_type: str, device_id: str = None, device_value=None, device_name: str = None, url: str = None) -> dict:
        """Register and attach a working discovered device to the active camera list."""
        if device_type == "webcam":
            camera_id = device_id or "CAM-WEBCAM"
            if camera_id in self.readers and self.readers[camera_id].running:
                return {"status": "already_connected", "camera_id": camera_id}
            result = self.enable_webcam(device_index=int(device_value or 0), camera_id=camera_id)
            if result.get("status") != "started":
                return {**result, "camera_id": camera_id, "type": "webcam"}
            return {"status": "connected", "camera_id": camera_id, "type": "webcam"}

        if device_type == "rtsp":
            camera_id = device_id or f"CAM-RTSP-{int(time.time()) % 10000}"
            if camera_id in self.readers and self.readers[camera_id].running:
                return {"status": "already_connected", "camera_id": camera_id}
            reader = RTSPStreamReader(
                rtsp_url=str(url or device_value),
                camera_id=camera_id,
                camera_name=device_name or camera_id,
                source_type="rtsp",
                fps_log_interval=4.0
            )
            self.readers[camera_id] = reader
            self.configs = [cam for cam in self.configs if cam.get("id") != camera_id]
            self.configs.append({
                "id": camera_id,
                "name": device_name or camera_id,
                "type": "rtsp",
                "url": str(url or device_value),
                "enabled": True,
            })
            reader.start()
            return {"status": "connected", "camera_id": camera_id, "type": "rtsp"}

        return {"status": "unsupported", "device_type": device_type}

    @staticmethod
    def enumerate_webcams(max_probe: int = 6) -> list:
        """Backward-compatible webcam probe API returning only working cameras."""
        available = []
        for i in range(max_probe):
            cap = CameraManager._probe_capture(i)
            if cap is None:
                continue
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            available.append({"index": i, "name": f"Webcam Device #{i} ({w}x{h})"})
            cap.release()
        return available


# Global Singleton Camera Manager Instance
camera_manager = CameraManager()
