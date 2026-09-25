import os

from camera_manager import CameraManager, _load_default_camera_list


def test_default_camera_list_never_uses_zone_names_as_rtsp_urls(monkeypatch):
    """Default camera list must never auto-open a webcam or treat zone labels as stream URLs."""
    monkeypatch.delenv("PRAHARI_CAMERAS", raising=False)

    class FakeDB:
        @staticmethod
        def get_admin_cameras_config():
            return [
                {"camera_id": "CAM-01", "name": "Border Post Alpha", "location_zone": "Border Restricted Zone"},
                {"camera_id": "CAM-02", "name": "Night Surveillance Bravo", "location_zone": "Night Checkpoint Bravo"},
            ]

    import camera_manager as camera_manager_module
    monkeypatch.setattr(camera_manager_module, "_load_camera_config", lambda: [])
    monkeypatch.setattr("database.db_manager.get_admin_cameras_config", FakeDB.get_admin_cameras_config)

    cameras = _load_default_camera_list()

    assert cameras[0]["enabled"] is False
    assert cameras[0]["type"] in {"manual", "placeholder", "disabled"}
    assert cameras[0]["url"] in {"", None}
    assert all("Restricted Zone" not in str(cam.get("url", "")) for cam in cameras)
    assert all(not str(cam.get("url", "")).isdigit() for cam in cameras if cam.get("type") in {"manual", "placeholder", "disabled"})


def test_discover_video_sources_filters_unreachable_devices(monkeypatch):
    import camera_manager as camera_manager_module

    class FakeCapture:
        def __init__(self, source, *args, **kwargs):
            self.source = source

        def isOpened(self):
            return self.source not in (2, "rtsp://bad")

        def read(self):
            return True, None

        def get(self, prop):
            if prop in (camera_manager_module.cv2.CAP_PROP_FRAME_WIDTH, camera_manager_module.cv2.CAP_PROP_FRAME_HEIGHT):
                return 1920 if prop == camera_manager_module.cv2.CAP_PROP_FRAME_WIDTH else 1080
            return 0

        def release(self):
            pass

    monkeypatch.setattr(camera_manager_module.cv2, "VideoCapture", FakeCapture)
    monkeypatch.setattr(camera_manager_module.cv2, "CAP_DSHOW", 700)

    cm = CameraManager(camera_configs=[])
    devices = cm.discover_video_sources(max_webcams=4, rtsp_candidates=["rtsp://good", "rtsp://bad"])

    assert any(d["type"] == "webcam" and d["index"] == 0 for d in devices)
    assert any(d["url"] == "rtsp://good" for d in devices)
    assert not any(d["url"] == "rtsp://bad" for d in devices)
    assert all(d["status"] == "working" for d in devices)


def test_connect_detected_camera_registers_active_camera(monkeypatch):
    import camera_manager as camera_manager_module

    class FakeReader:
        def __init__(self, **kwargs):
            self.camera_id = kwargs["camera_id"]
            self.camera_name = kwargs["camera_name"]
            self.rtsp_url = kwargs["rtsp_url"]
            self.source_type = kwargs["source_type"]
            self.running = False
            self.is_connected = True
            self.status = "ONLINE"

        def start(self):
            self.running = True
            self.is_connected = True
            self.status = "ONLINE"

    monkeypatch.setattr(camera_manager_module, "RTSPStreamReader", FakeReader)

    cm = CameraManager(camera_configs=[])
    result = cm.connect_detected_camera(
        device_type="webcam",
        device_id="CAM-USB-0",
        device_value=0,
        device_name="Webcam #0",
    )

    assert result["status"] == "connected"
    assert "CAM-USB-0" in cm.readers
