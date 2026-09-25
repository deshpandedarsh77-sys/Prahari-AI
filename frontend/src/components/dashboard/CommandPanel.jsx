import React, { useEffect, useState } from 'react';
import { AlertOctagon, CheckCircle2, LoaderCircle, Send, UsersRound, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { fetchCommandChain, sendOperatorSos } from '../../services/notificationApi';

export function CommandPanel({ isOpen, onClose, currentUser }) {
  const [operators, setOperators] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [broadcast, setBroadcast] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    setBroadcast(false);
    setSelectedIds([]);
    setLoading(true);
    fetchCommandChain()
      .then((items) => setOperators(Array.isArray(items) ? items.filter((item) => item.id !== currentUser?.id) : []))
      .catch((error) => setFeedback({ type: 'error', text: error.message }))
      .finally(() => setLoading(false));
  }, [isOpen, currentUser?.id]);

  if (!isOpen) return null;

  const toggleOperator = (id) => {
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  };

  const handleSend = async (event) => {
    event.preventDefault();
    if ((!selectedIds.length && !broadcast) || message.trim().length < 3 || sending) return;
    setSending(true);
    setFeedback(null);
    try {
      await sendOperatorSos(selectedIds, message.trim(), broadcast);
      setFeedback({ type: 'success', text: broadcast ? 'Distress signal broadcast to every active operator.' : 'SOS sent to the selected operators.' });
      setMessage('');
    } catch (error) {
      setFeedback({ type: 'error', text: error.message });
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div className="cc-command-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cc-command-panel" role="dialog" aria-modal="true" aria-labelledby="cc-command-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="cc-command-header">
          <div className="cc-command-title">
            <span className="cc-command-icon"><UsersRound style={{ width: 18, height: 18 }} /></span>
            <div><span className="cc-alert-modal-eyebrow">Operations network</span><h2 id="cc-command-title">Chain of command</h2></div>
          </div>
          <button className="cc-alert-modal-close" type="button" onClick={onClose} aria-label="Close command panel"><X style={{ width: 19, height: 19 }} /></button>
        </header>

        <div className="cc-command-body">
          {currentUser?.role === 'SUPER_ADMIN' && (
            <label className={`cc-command-operator ${broadcast ? 'selected' : ''}`}>
              <input type="checkbox" checked={broadcast} onChange={(event) => setBroadcast(event.target.checked)} />
              <span className="cc-command-avatar"><AlertOctagon style={{ width: 16, height: 16 }} /></span>
              <span className="cc-command-person"><strong>Broadcast distress signal</strong><small>Deliver to every active operator</small></span>
              <span className="cc-command-role">ALL OPERATORS</span>
            </label>
          )}
          <div className="cc-command-section-heading"><span>Available operators</span><small>Select recipients for an SOS</small></div>
          {loading ? <div className="cc-command-empty"><LoaderCircle className="spin-icon" /> Loading command chain...</div> : operators.length === 0 ? <div className="cc-command-empty">No other active operators are available.</div> : (
            <div className="cc-command-list">
              {operators.map((operator) => (
                <label className={`cc-command-operator ${selectedIds.includes(operator.id) ? 'selected' : ''}`} key={operator.id}>
                  <input type="checkbox" checked={selectedIds.includes(operator.id)} onChange={() => toggleOperator(operator.id)} />
                  <span className="cc-command-avatar">{(operator.full_name || operator.username || 'O').charAt(0).toUpperCase()}</span>
                  <span className="cc-command-person"><strong>{operator.full_name || operator.username}</strong><small>{operator.username}</small></span>
                  <span className="cc-command-role">{operator.role.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          )}

          <form className="cc-sos-form" onSubmit={handleSend}>
            <div className="cc-command-section-heading"><span><AlertOctagon style={{ width: 16, height: 16 }} /> SOS message</span><small>Delivered as a critical alert</small></div>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={3} placeholder="Describe the immediate situation and action required..." />
            <div className="cc-sos-footer"><small>{message.length}/500</small><button className="cc-sos-button" type="submit" disabled={sending || (!selectedIds.length && !broadcast) || message.trim().length < 3}><Send style={{ width: 15, height: 15 }} /> {sending ? 'Sending...' : broadcast ? 'Broadcast Distress' : 'Send SOS'}</button></div>
          </form>
          {feedback && <div className={`cc-command-feedback ${feedback.type}`}>{feedback.type === 'success' ? <CheckCircle2 /> : <AlertOctagon />}<span>{feedback.text}</span></div>}
        </div>
      </section>
    </div>,
    document.body
  );
}