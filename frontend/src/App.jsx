import React, { useState, useCallback, useEffect } from 'react';
import { Dashboard } from './components/dashboard/Dashboard';
import { FocusModal } from './components/FocusModal';
import { AnalyticsDrawer } from './components/AnalyticsDrawer';
import { Lightbox } from './components/Lightbox';
import { usePolling } from './hooks/usePolling';
import './styles/dashboard.css';

import { AdminLayout } from './components/admin/AdminLayout';
import { AdminLogin } from './components/admin/AdminLogin';
import {
  getStoredUser,
  fetchCurrentUser,
  logout,
  getAuthToken,
  updateAdminIncident
} from './services/adminApi';

import {
  fetchDashboardStats,
  fetchAnalytics,
  fetchAlerts,
  fetchAllEvents,
  fetchAnprLog,
  fetchSecurityEvents,
  fetchAvailableDevices,
  refreshDetectedDevices,
  connectDetectedDevice,
  startWebcam,
  stopWebcam
  ,fetchRuntimeProfile
  ,applyRuntimeProfile
} from './services/api';
import { IncidentDetailModal } from './components/dashboard/IncidentDetailModal';
import { CommandPanel } from './components/dashboard/CommandPanel';

import { useNotificationSocket } from './hooks/useNotificationSocket';
import { NotificationDrawer } from './components/notifications/NotificationDrawer';
import { ToastContainer } from './components/notifications/ToastContainer';
import { NotificationsPage } from './components/notifications/NotificationsPage';
import { ErrorBoundary } from './components/common/ErrorBoundary';

const parseRoute = () => {
  const path = window.location.pathname;
  if (path === '/login') {
    return { view: 'login', tab: 'overview' };
  }
  if (path === '/notifications') {
    return { view: 'notifications', tab: 'all' };
  }
  if (path.startsWith('/admin')) {
    const parts = path.split('/').filter(Boolean);
    const tab = parts[1] || 'overview';
    return { view: 'admin', tab };
  }
  return { view: 'dashboard', tab: 'overview' };
};

export function App() {
  const [currentRoute, setCurrentRoute] = useState(parseRoute);
  const [currentUser, setCurrentUser] = useState(getStoredUser);

  const [dashboardData, setDashboardData] = useState({});
  const [verifiedAnprCount, setVerifiedAnprCount] = useState(0);
  const [eventsFeed, setEventsFeed] = useState([]);
  const [activeTab, setActiveTab] = useState('all');
  const [runtimeProfile, setRuntimeProfile] = useState(() => localStorage.getItem('prahari_profile') || 'lite');
  const [profileBusy, setProfileBusy] = useState(false);

  const [isWebcamRunning, setIsWebcamRunning] = useState(false);
  const [isWebcamTransitioning, setIsWebcamTransitioning] = useState(false);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [detectedDevices, setDetectedDevices] = useState([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);
  const [isDeviceScanBusy, setIsDeviceScanBusy] = useState(false);
  const [isConnectingDevices, setIsConnectingDevices] = useState(false);
  const [hasAutoScanned, setHasAutoScanned] = useState(false);

  const [focusModal, setFocusModal] = useState({ isOpen: false, cameraId: null, cameraTitle: '' });
  const [analyticsModal, setAnalyticsModal] = useState({ isOpen: false, data: {} });
  const [lightboxModal, setLightboxModal] = useState({ isOpen: false, imgUrl: '', caption: '' });
  const [incidentModal, setIncidentModal] = useState({ isOpen: false, event: null });
  const [commandPanelOpen, setCommandPanelOpen] = useState(false);

  // URL Navigation & Session Listeners
  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(parseRoute());
    };
    const handleUnauthorized = () => {
      setCurrentUser(null);
      const path = window.location.pathname;
      if (path.startsWith('/admin') || path === '/notifications') {
        navigateTo('login');
      }
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('prahari:unauthorized', handleUnauthorized);

    if (getAuthToken()) {
      fetchCurrentUser()
        .then(u => setCurrentUser(u))
        .catch(() => setCurrentUser(null));
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('prahari:unauthorized', handleUnauthorized);
    };
  }, []);

  // Ensure #root has cc-root class for zero padding on operations dashboard
  useEffect(() => {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      if (currentRoute.view === 'dashboard') {
        rootEl.classList.add('cc-root');
      } else {
        rootEl.classList.remove('cc-root');
      }
    }
  }, [currentRoute.view]);

  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] = useState(false);

  const navigateTo = (view, tab = 'overview') => {
    let path = '/dashboard';
    if (view === 'login') path = '/login';
    else if (view === 'notifications') path = '/notifications';
    else if (view === 'admin') path = tab === 'overview' ? '/admin' : `/admin/${tab}`;
    window.history.pushState({}, '', path);
    setCurrentRoute({ view, tab });
  };

  const handleOpenIncident = useCallback((eventOrId) => {
    const event = typeof eventOrId === 'object' ? eventOrId : null;
    if (event) {
      setIncidentModal({ isOpen: true, event });
      return;
    }
    navigateTo('admin', 'incidents');
  }, []);

  const handleIncidentStatusAction = useCallback(async (status) => {
    const incidentId = incidentModal.event?.incident_id;
    if (!incidentId) return;
    try {
      const updated = await updateAdminIncident(incidentId, {
        status,
        notes: `Operator changed status to ${status}.`
      });
      setIncidentModal((previous) => ({
        ...previous,
        event: { ...previous.event, ...updated, status }
      }));
    } catch (error) {
      alert(`Could not update incident: ${error.message}`);
    }
  }, [incidentModal.event]);

  const handleChangeRuntimeProfile = useCallback(async (profile) => {
    if (profile === runtimeProfile || profileBusy) return;
    setProfileBusy(true);
    try {
      const result = await applyRuntimeProfile(profile);
      setRuntimeProfile(result.profile);
      localStorage.setItem('prahari_profile', result.profile);
      window.dispatchEvent(new CustomEvent('prahari:profile_changed', { detail: result }));
    } catch (err) {
      console.error('Runtime profile update failed:', err);
      alert(`Could not apply ${profile} profile: ${err.message}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileBusy, runtimeProfile]);

  useEffect(() => {
    fetchRuntimeProfile().then((result) => {
      if (result.profile) setRuntimeProfile(result.profile);
    }).catch(() => {});
  }, []);

  const {
    status: notifStatus,
    error: notifError,
    notifications,
    unreadCount,
    activeIncidentsCount,
    attentionSeverity,
    connectionStatus: notifConnectionStatus,
    toasts,
    soundActive,
    desktopPermission,
    dismissToast,
    handleMarkRead,
    handleMarkAllRead,
    toggleSound,
    requestDesktopPermission,
    refreshNotifications
  } = useNotificationSocket({
    onOpenIncident: handleOpenIncident
  });

  const isDashboardView = currentRoute.view === 'dashboard';

  // 1. Telemetry Polling (1000ms) - active when in dashboard view
  const pollTelemetry = useCallback(async () => {
    try {
      const data = await fetchDashboardStats();
      setDashboardData(data);

      const activeCams = data.cameras || [];
      const webcamActive = activeCams.some(c => c.camera_id === 'CAM-WEBCAM' && (c.connected || c.active));
      if (webcamActive && !isWebcamRunning) {
        setIsWebcamRunning(true);
      } else if (!webcamActive && isWebcamRunning && !isWebcamTransitioning) {
        setIsWebcamRunning(false);
      }
    } catch (err) {
      console.error("Telemetry fetch error:", err);
    }
  }, [isWebcamRunning, isWebcamTransitioning]);

  usePolling(pollTelemetry, 1000, isDashboardView);

  // 2. Events Feed Polling (1500ms) - active when in dashboard view
  const pollEvents = useCallback(async () => {
    try {
      let events = [];
      if (activeTab === 'anpr') {
        events = await fetchAnprLog(25);
      } else if (activeTab === 'suspicious') {
        events = await fetchSecurityEvents(25, 'suspicious_activity');
      } else if (activeTab === 'intrusions') {
        events = await fetchAlerts(25);
      } else {
        events = await fetchAllEvents(25);
      }
      setEventsFeed(events);
    } catch (err) {
      console.error("Events feed error:", err);
    }
  }, [activeTab]);

  usePolling(pollEvents, 1500, isDashboardView);

  // 3. Analytics Summary KPI Polling (5000ms)
  const pollAnalyticsKpi = useCallback(async () => {
    try {
      const stats = await fetchAnalytics();
      setVerifiedAnprCount(stats.verified_plates_count || 0);
    } catch (err) {
      console.error("Analytics KPI error:", err);
    }
  }, []);

  usePolling(pollAnalyticsKpi, 5000, isDashboardView);

  // Handlers
  const handleToggleWebcam = async () => {
    if (isWebcamTransitioning) return;
    setIsWebcamTransitioning(true);

    if (!isWebcamRunning) {
      try {
        const res = await startWebcam(0);
        if (res.status === 'started' || res.status === 'already_running') {
          setIsWebcamRunning(true);
        } else {
          alert("Could not start webcam: " + (res.error || "Device unavailable"));
          setIsWebcamRunning(false);
        }
      } catch (err) {
        alert("Webcam error: " + err.message);
        setIsWebcamRunning(false);
      } finally {
        setIsWebcamTransitioning(false);
      }
    } else {
      try {
        await stopWebcam();
        setIsWebcamRunning(false);
      } catch (err) {
        console.error("Error stopping webcam:", err);
      } finally {
        setIsWebcamTransitioning(false);
      }
    }
  };

  const handleRefreshDetectedDevices = useCallback(async (autoConnect = false) => {
    setIsDeviceScanBusy(true);
    try {
      const payload = await refreshDetectedDevices();
      const nextDevices = payload.devices || [];
      setDetectedDevices(nextDevices);
      setSelectedDeviceIds((previous) => previous.filter((id) => nextDevices.some((device) => device.id === id && !device.connected)));
      if (autoConnect && nextDevices.length > 0) {
        for (const device of nextDevices) {
          try {
            await connectDetectedDevice({
              device_type: device.type,
              device_id: device.id,
              device_value: device.type === 'webcam' ? device.index : device.url,
              device_name: device.name,
              url: device.type === 'rtsp' ? device.url : null,
            });
          } catch (err) {
            console.warn('Skipping failed auto-connect:', device, err);
          }
        }
      }
      setDeviceModalOpen(true);
      return nextDevices;
    } catch (err) {
      console.error('Failed to scan devices:', err);
      setDetectedDevices([]);
      return [];
    } finally {
      setIsDeviceScanBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isDashboardView) return;
    if (hasAutoScanned) return;
    setHasAutoScanned(true);
    handleRefreshDetectedDevices(false);
  }, [isDashboardView, hasAutoScanned, handleRefreshDetectedDevices]);

  const handleConnectDetectedDevice = useCallback(async (device) => {
    try {
      const payload = {
        device_type: device.type,
        device_id: device.id,
        device_value: device.type === 'webcam' ? device.index : device.url,
        device_name: device.name,
        url: device.type === 'rtsp' ? device.url : null,
      };
      const result = await connectDetectedDevice(payload);
      if (result.status === 'connected' || result.status === 'already_connected') {
        setDetectedDevices((previous) => previous.map((item) => item.id === device.id ? { ...item, connected: true } : item));
        setSelectedDeviceIds((previous) => previous.filter((id) => id !== device.id));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Could not connect device:', err);
      return false;
    }
  }, []);

  const handleConnectSelectedDevices = useCallback(async () => {
    const selected = detectedDevices.filter((device) => selectedDeviceIds.includes(device.id) && !device.connected);
    if (!selected.length || isConnectingDevices) return;
    setIsConnectingDevices(true);
    for (const device of selected) {
      await handleConnectDetectedDevice(device);
    }
    setIsConnectingDevices(false);
  }, [detectedDevices, selectedDeviceIds, isConnectingDevices, handleConnectDetectedDevice]);

  const handleOpenAnalytics = async () => {
    try {
      const data = await fetchAnalytics();
      setAnalyticsModal({ isOpen: true, data });
    } catch (err) {
      console.error("Failed to open analytics:", err);
    }
  };

  const handleFocusCamera = (cameraId, cameraTitle) => {
    setFocusModal({ isOpen: true, cameraId, cameraTitle });
  };

  const handleOpenLightbox = (imgUrl, caption) => {
    setLightboxModal({ isOpen: true, imgUrl, caption });
  };

  // ─── RENDER ADMIN LOGIN VIEW ───
  if (currentRoute.view === 'login') {
    return (
      <AdminLogin
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          navigateTo('admin', 'overview');
        }}
        onBackToDashboard={() => navigateTo('dashboard')}
      />
    );
  }

  // ─── RENDER ADMIN PANEL VIEW ───
  if (currentRoute.view === 'admin') {
    if (!currentUser) {
      return (
        <AdminLogin
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            navigateTo('admin', currentRoute.tab || 'overview');
          }}
          onBackToDashboard={() => navigateTo('dashboard')}
        />
      );
    }

    return (
      <ErrorBoundary onRetry={() => navigateTo('admin', currentRoute.tab || 'overview')}>
        <AdminLayout
          currentUser={currentUser}
          activeTab={currentRoute.tab || 'overview'}
          onTabChange={(tab) => navigateTo('admin', tab)}
          onLogout={async () => {
            await logout();
            setCurrentUser(null);
            navigateTo('dashboard');
          }}
          onBackToDashboard={() => navigateTo('dashboard')}
        />
        <ToastContainer
          toasts={toasts}
          onDismiss={dismissToast}
          onOpenIncident={handleOpenIncident}
        />
      </ErrorBoundary>
    );
  }

  // ─── RENDER NOTIFICATIONS VIEW ───
  if (currentRoute.view === 'notifications') {
    return (
      <ErrorBoundary onRetry={() => navigateTo('notifications')}>
        <NotificationsPage
          onNavigateToIncident={handleOpenIncident}
          onBack={() => navigateTo('dashboard')}
        />
        <IncidentDetailModal
          event={incidentModal.event}
          isOpen={incidentModal.isOpen}
          onClose={() => setIncidentModal({ isOpen: false, event: null })}
          onOpenEvidence={handleOpenLightbox}
          onStatusAction={handleIncidentStatusAction}
          onManage={() => {
            setIncidentModal({ isOpen: false, event: null });
            navigateTo('admin', 'incidents');
          }}
        />
        <ToastContainer
          toasts={toasts}
          onDismiss={dismissToast}
          onOpenIncident={handleOpenIncident}
        />
      </ErrorBoundary>
    );
  }

  // ─── RENDER OPERATIONS DASHBOARD VIEW ───
  return (
    <>
      {deviceModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setDeviceModalOpen(false)}
        >
          <div
            style={{
              width: 'min(680px, 92vw)',
              maxHeight: '78vh',
              overflowY: 'auto',
              borderRadius: 18,
              background: '#0f172a',
              border: '1px solid #243754',
              boxShadow: '0 18px 45px rgba(5, 10, 20, 0.55)',
              color: '#e7edf9',
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Connect CCTV Cameras</div>
                <div style={{ color: '#9bb0d1', fontSize: 13 }}>Only working devices are shown here.</div>
              </div>
              <button
                type="button"
                onClick={() => setDeviceModalOpen(false)}
                style={{
                  background: '#1e293b',
                  color: '#e2e8f0',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button
                className="cc-btn cc-btn-admin"
                type="button"
                onClick={() => handleRefreshDetectedDevices(false)}
                disabled={isDeviceScanBusy}
              >
                {isDeviceScanBusy ? 'Scanning...' : 'Refresh Devices'}
              </button>
              <button
                className="cc-btn cc-btn-webcam"
                type="button"
                onClick={handleConnectSelectedDevices}
                disabled={isConnectingDevices || selectedDeviceIds.length === 0}
              >
                {isConnectingDevices ? 'Connecting...' : `Connect selected (${selectedDeviceIds.length})`}
              </button>
            </div>

            {detectedDevices.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 12, background: '#111c2c', border: '1px solid #22324a', color: '#c9d7ee' }}>
                No working video devices were detected. Refresh to rescan your CCTV or USB cameras.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {detectedDevices.map((device) => (
                  <div key={`${device.type}-${device.id || device.url || device.index}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: '#111c2c', border: '1px solid #22324a' }}>
                    <input
                      type="checkbox"
                      checked={selectedDeviceIds.includes(device.id)}
                      disabled={device.connected || isConnectingDevices}
                      onChange={(event) => setSelectedDeviceIds((previous) => event.target.checked ? [...previous, device.id] : previous.filter((id) => id !== device.id))}
                      aria-label={`Select ${device.name}`}
                    />
                    <div>
                      <div style={{ fontWeight: 700 }}>{device.name}</div>
                      <div style={{ fontSize: 12, color: '#9bb0d1' }}>
                        {device.type === 'webcam' ? `USB index ${device.index}` : device.url}
                      </div>
                    </div>
                    <span style={{ marginLeft: 'auto', color: device.connected ? '#6ee7b7' : '#9bb0d1', fontSize: 12 }}>
                      {device.connected ? 'Connected' : 'Available'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dashboard
        dashboardData={dashboardData}
        verifiedAnprCount={verifiedAnprCount}
        eventsFeed={eventsFeed}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isWebcamRunning={isWebcamRunning}
        isWebcamTransitioning={isWebcamTransitioning}
        onToggleWebcam={handleToggleWebcam}
        onConnectCctv={() => {
          setDeviceModalOpen(true);
        }}
        onFocusCamera={handleFocusCamera}
        onOpenLightbox={handleOpenLightbox}
        onOpenIncident={handleOpenIncident}
        onOpenAnalytics={handleOpenAnalytics}
        onNavigateToAdmin={() => navigateTo(currentUser ? 'admin' : 'login', 'overview')}
        currentUser={currentUser}
        unreadCount={unreadCount}
        activeIncidentsCount={activeIncidentsCount}
        attentionSeverity={attentionSeverity}
        notificationConnectionStatus={notifConnectionStatus}
        isNotificationDrawerOpen={isNotificationDrawerOpen}
        onToggleNotificationDrawer={() => setIsNotificationDrawerOpen(prev => !prev)}
        onViewAllNotifications={() => navigateTo('notifications')}
        runtimeProfile={runtimeProfile}
        onChangeRuntimeProfile={handleChangeRuntimeProfile}
        profileBusy={profileBusy}
        onOpenCommandPanel={() => currentUser && setCommandPanelOpen(true)}
      />

      <FocusModal
        isOpen={focusModal.isOpen}
        selectedCameraId={focusModal.cameraId}
        isWebcamRunning={isWebcamRunning}
        onSelectCamera={(id, title) => setFocusModal({ isOpen: true, cameraId: id, cameraTitle: title })}
        onClose={() => setFocusModal({ isOpen: false, cameraId: null, cameraTitle: '' })}
      />

      <AnalyticsDrawer
        isOpen={analyticsModal.isOpen}
        analyticsData={analyticsModal.data}
        onClose={() => setAnalyticsModal({ isOpen: false, data: {} })}
      />

      <Lightbox
        isOpen={lightboxModal.isOpen}
        imageUrl={lightboxModal.imgUrl}
        caption={lightboxModal.caption}
        onClose={() => setLightboxModal({ isOpen: false, imgUrl: '', caption: '' })}
      />
      <IncidentDetailModal
        event={incidentModal.event}
        isOpen={incidentModal.isOpen}
        onClose={() => setIncidentModal({ isOpen: false, event: null })}
        onOpenEvidence={handleOpenLightbox}
        onStatusAction={handleIncidentStatusAction}
        onManage={(incidentId) => {
          setIncidentModal({ isOpen: false, event: null });
          navigateTo('admin', 'incidents');
        }}
      />
      <CommandPanel
        isOpen={commandPanelOpen}
        onClose={() => setCommandPanelOpen(false)}
        currentUser={currentUser}
      />

      <NotificationDrawer
        isOpen={isNotificationDrawerOpen}
        onClose={() => setIsNotificationDrawerOpen(false)}
        status={notifStatus}
        error={notifError}
        onRetry={refreshNotifications}
        onNavigateToLogin={() => navigateTo('login')}
        notifications={notifications}
        unreadCount={unreadCount}
        activeIncidentsCount={activeIncidentsCount}
        connectionStatus={notifConnectionStatus}
        soundActive={soundActive}
        onToggleSound={toggleSound}
        desktopPermission={desktopPermission}
        onRequestDesktopPermission={requestDesktopPermission}
        onMarkRead={handleMarkRead}
        onMarkAllRead={handleMarkAllRead}
        onOpenIncident={handleOpenIncident}
        onViewAll={() => navigateTo('notifications')}
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onOpenIncident={handleOpenIncident}
      />
    </>
  );
}
