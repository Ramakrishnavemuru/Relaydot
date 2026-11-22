import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Flag, ShieldCheck, X } from 'lucide-react'
import { api } from './api'

const reasons = [
  ['spam', 'Spam'], ['harassment', 'Harassment'], ['hate', 'Hate or abusive behavior'],
  ['impersonation', 'Impersonation'], ['inappropriate', 'Inappropriate content'],
  ['scam', 'Scam or fraud'], ['threats', 'Threatening content'], ['other', 'Other'],
]

export function ReportDialog({ entityType, entityId, onClose }: { entityType: 'user' | 'story' | 'post' | 'community'; entityId: number; onClose: () => void }) {
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const submit = useMutation({ mutationFn: () => api('/social/reports', { method: 'POST', body: { entity_type: entityType, entity_id: entityId, reason, details: details.trim() || null } }), onSuccess: () => onClose(), onError: (cause: Error) => setError(cause.message) })

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="dialog-card report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title" aria-describedby="report-dialog-description">
      <header className="report-dialog-header"><span className="report-dialog-icon"><Flag size={21} /></span><div><span className="report-dialog-kicker">HELP KEEP RELAY SAFE</span><h2 id="report-dialog-title">Report {entityType}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close report"><X size={20} /></button></header>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); submit.mutate() }}>
        <p id="report-dialog-description" className="report-dialog-intro">Tell us what happened. Choose the closest reason, then add any context that would help our team review it.</p>
        <label className="report-field">Reason <span className="report-required">Required</span><select value={reason} onChange={event => setReason(event.target.value)}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="report-field">Details <span className="report-optional">Optional</span><textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={500} placeholder="Describe the issue in your own words…" /></label>
        <div className="report-field-help"><span>Include only what you choose to share.</span><span>{details.length}/500</span></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="report-dialog-footer"><span><ShieldCheck size={17} /> Reviewed by Relay staff</span><div><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit report'}</button></div></div>
      </form>
    </div>
  </div>
}
