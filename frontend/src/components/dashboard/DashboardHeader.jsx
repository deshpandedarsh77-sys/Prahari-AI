import React from 'react';
import { ShieldAlert, BarChart3, Camera, ShieldCheck, Settings2, UsersRound } from 'lucide-react';
import { SystemTelemetry } from './SystemTelemetry';
import { NotificationBell } from '../notifications/NotificationBell';

export function DashboardHeader({
  gpuInfo = {},
  aggregateAiFps = 0.0,
  activeCameras = 4,
  totalCameras = 4,
  threatScore = 0,
  threatLevel = 'NORMAL',
  onOpenAnalytics,
  onNavigateToAdmin,
  onConnectCctv,
  currentUser = null,
  unreadCount = 0,
  attentionSeverity = null,
  notificationConnectionStatus = 'disconnected',
  isNotificationDrawerOpen = false,
  onToggleNotificationDrawer,
  runtimeProfile = 'lite',
  onChangeRuntimeProfile,
  profileBusy = false,
  onOpenCommandPanel
}) {
  return (
    <header className="cc-header" role="banner">
      {/* Left Brand Identity */}
      <div className="cc-header-left">
        <div className="cc-brand-badge" title="PRAHARI-AI Unified Defense">
          <ShieldAlert style={{ width: 24, height: 24 }} />
        </div>
        <div className="cc-brand-titles">
          <div className="cc-brand-name">
            PRAHARI<span>-AI</span>
          </div>
          <div className="cc-brand-subtitle">
            Smart security operations
          </div>
        </div>
      </div>

      {/* Center System Telemetry Strip */}
      <SystemTelemetry
        gpuInfo={gpuInfo}
        aggregateAiFps={aggregateAiFps}
        activeCameras={activeCameras}
        totalCameras={totalCameras}
        threatScore={threatScore}
        threatLevel={threatLevel}
      />

      {/* Right Actions: CCTV scan, alerts, analytics, admin, user */}
      <div className="cc-header-right">
        <label className="cc-profile-control" title="Select AI processing profile">
          <Settings2 style={{ width: 15, height: 15 }} />
          <span className="cc-profile-label">AI mode</span>
          <select
            value={runtimeProfile}
            onChange={(event) => onChangeRuntimeProfile && onChangeRuntimeProfile(event.target.value)}
            disabled={profileBusy}
            aria-label="AI processing profile"
          >
            <option value="lite">Lite</option>
            <option value="balanced">Balanced</option>
            <option value="high">High</option>
          </select>
        </label>
        <button
          className="cc-btn cc-btn-command"
          onClick={onOpenCommandPanel}
          title="Open chain of command and SOS messaging"
          type="button"
        >
          <UsersRound style={{ width: 16, height: 16 }} />
          <span>Command</span>
        </button>
        <button
          className="cc-btn cc-btn-primary"
          onClick={onConnectCctv}
          title="Scan and connect CCTV or webcam devices"
          type="button"
        >
          <Camera style={{ width: 16, height: 16 }} />
          <span>Connect cameras</span>
        </button>

        <NotificationBell
          unreadCount={unreadCount}
          attentionSeverity={attentionSeverity}
          connectionStatus={notificationConnectionStatus}
          isOpen={isNotificationDrawerOpen}
          onToggle={onToggleNotificationDrawer}
        />

        <button
          className="cc-btn cc-btn-primary"
          onClick={onOpenAnalytics}
          title="Open Historical Analytics & Intelligence"
          type="button"
        >
          <BarChart3 style={{ width: 16, height: 16 }} />
          <span>Analytics</span>
        </button>

        <button
          className="cc-btn cc-btn-admin"
          onClick={onNavigateToAdmin}
          title="Open System Administration & Configuration"
          type="button"
        >
          <ShieldCheck style={{ width: 16, height: 16 }} />
          <span>Administration</span>
        </button>

        {currentUser && (
          <div className="cc-user-pill" title={`Logged in as ${currentUser.username || currentUser.email || 'Admin'}`}>
            <span className="cc-user-avatar">
              {(currentUser.username || 'A').charAt(0).toUpperCase()}
            </span>
            <span style={{ fontWeight: 600 }}>{currentUser.username || 'Admin'}</span>
          </div>
        )}
      </div>
    </header>
  );
}
