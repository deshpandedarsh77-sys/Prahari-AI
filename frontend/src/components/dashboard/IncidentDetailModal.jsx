import React, { useEffect, useState } from 'react';
import { AlertTriangle, Camera, Clock3, ExternalLink, ShieldAlert, X } from 'lucide-react';

function snapshotUrl(event) {
  if (!event) return '';
  if (event.snapshot_url) return event.snapshot_url;
  if (!event.snapshot_filename) return '';
  const folder = event.event_type === 'anpr' ? 'anpr' : 'alerts';
  return `/${folder}/${event.snapshot_filename}`;
}

function displayEventType(event) {
  return (event?.event_type || 'security event').replaceAll('_', ' ');
}

export function IncidentDetailModal({ event, isOpen, onClose, onOpenEvidence, onManage, onStatusAction, actionBusy = false }) {
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  useEffect(() => {
    setEvidenceExpanded(false);
  }, [isOpen, event?.id, event?.incident_id]);
  if (!isOpen || !event) return null;

  const imageUrl = snapshotUrl(event);
  let notificationMetadata = {};
  try {
    notificationMetadata = event.metadata ? JSON.parse(event.metadata) : {};
  } catch {
    notificationMetadata = {};
  }
  const severity = (event.severity || (event.event_type === 'anpr' ? 'INFO' : 'HIGH')).toUpperCase();
  const incidentId = event.incident_id || event.id;
  const confidence = event.confidence ?? event.plate_confidence;
  const incidentStatus = (event.status || notificationMetadata.status || 'NEW').toUpperCase();
  const investigatorName = event.assigned_officer_name || notificationMetadata.investigator_name;
  const hasIncidentRecord = Number.isInteger(Number(event.incident_id));

  return (
    <div className="cc-alert-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`cc-alert-modal ${evidenceExpanded ? 'evidence-expanded' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-alert-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cc-alert-modal-header">
          <div className="cc-alert-modal-heading">
            <span className={`cc-alert-modal-icon severity-${severity.toLowerCase()}`}>
              <ShieldAlert style={{ width: 18, height: 18 }} />
            </span>
            <div>
              <span className="cc-alert-modal-eyebrow">Alert details</span>
              <h2 id="cc-alert-modal-title">{event.title || displayEventType(event)}</h2>
            </div>
          </div>
          <button type="button" className="cc-alert-modal-close" onClick={onClose} aria-label="Close alert details">
            <X style={{ width: 19, height: 19 }} />
          </button>
        </header>

        <div className="cc-alert-modal-content">
          {imageUrl ? (
            <button
              type="button"
              className="cc-alert-modal-evidence"
              onClick={() => setEvidenceExpanded((expanded) => !expanded)}
            >
              <img src={imageUrl} alt="Alert evidence" />
              <span><ExternalLink style={{ width: 14, height: 14 }} /> {evidenceExpanded ? 'Close full evidence' : 'View full evidence'}</span>
            </button>
          ) : (
            <div className="cc-alert-modal-no-evidence">
              <AlertTriangle style={{ width: 25, height: 25 }} />
              <span>No evidence image attached to this alert</span>
            </div>
          )}

          <div className="cc-alert-modal-facts">
            <div className="cc-alert-fact"><Camera /> <span>Camera</span><strong>{event.camera_id || 'System'}</strong></div>
            <div className="cc-alert-fact"><ShieldAlert /> <span>Severity</span><strong>{severity}</strong></div>
            <div className="cc-alert-fact"><Clock3 /> <span>Detected</span><strong>{event.timestamp || event.created_at || 'Unavailable'}</strong></div>
            <div className="cc-alert-fact"><AlertTriangle /> <span>Event</span><strong style={{ textTransform: 'capitalize' }}>{displayEventType(event)}</strong></div>
            {investigatorName && <div className="cc-alert-fact"><ShieldAlert /> <span>Investigating operator</span><strong>{investigatorName}</strong></div>}
            {event.plate_text && <div className="cc-alert-fact"><span className="cc-alert-fact-label">Plate</span><strong>{event.plate_text}</strong></div>}
            {confidence !== undefined && confidence !== null && <div className="cc-alert-fact"><span className="cc-alert-fact-label">Confidence</span><strong>{`${(Number(confidence) * 100).toFixed(0)}%`}</strong></div>}
          </div>

          {(event.message || event.details || event.meta) && (
            <p className="cc-alert-modal-message">{event.message || event.details || event.meta}</p>
          )}
          <div className="cc-alert-modal-operator-note">
            <strong>Operator response</strong>
            <span>Review the evidence, confirm the camera and severity, notify the appropriate command contact, then update the incident state.</span>
          </div>
          <div className="cc-alert-modal-actions-grid">
            <strong>Incident actions</strong>
            <div>
              {hasIncidentRecord && incidentStatus === 'NEW' && <button type="button" disabled={actionBusy} onClick={() => onStatusAction && onStatusAction('ACKNOWLEDGED')}>Acknowledge</button>}
              {hasIncidentRecord && incidentStatus === 'ACKNOWLEDGED' && <button type="button" disabled={actionBusy} onClick={() => onStatusAction && onStatusAction('INVESTIGATING')}>Start investigation</button>}
              {hasIncidentRecord && ['ACKNOWLEDGED', 'INVESTIGATING'].includes(incidentStatus) && <button type="button" disabled={actionBusy} onClick={() => onStatusAction && onStatusAction('RESOLVED')}>Resolve</button>}
              {hasIncidentRecord && ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(incidentStatus) && <button type="button" disabled={actionBusy} onClick={() => onStatusAction && onStatusAction('DISMISSED')}>Dismiss</button>}
              {!hasIncidentRecord && <span className="cc-alert-action-hint">Use incident management to assign and transition this event.</span>}
            </div>
          </div>
        </div>

        <footer className="cc-alert-modal-actions">
          {incidentId && onManage && (
            <button type="button" className="cc-alert-manage-button" onClick={() => onManage(incidentId)}>
              Open incident management
            </button>
          )}
          <button type="button" className="cc-alert-dismiss-button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
