import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { api } from './api'
import { ErrorBox, GlassDialog } from './components'

type SecurityStatus = {
  encryption_version: number
  e2ee_enabled: boolean
  messages: string
  attachments: string
  identity_verification: string
}

export function CommunicationSecurity({ conversationId, close }: { conversationId: number; close: () => void }) {
  const status = useQuery({
    queryKey: ['communication-security', conversationId],
    queryFn: () => api<SecurityStatus>(`/messages/conversations/${conversationId}/security`),
    staleTime: 0,
  })
  return <GlassDialog title="Conversation security" onClose={close}>
    <div className="communication-security">
      {status.isPending && <p role="status">Checking protection…</p>}
      {status.error && <ErrorBox error={status.error} retry={() => void status.refetch()} />}
      {status.data && <>
        <ShieldAlert size={28} aria-hidden="true" />
        <h3>End-to-end encryption unavailable</h3>
        <p>Relaydot’s server can read messages and attached files in this conversation, including its history.</p>
        <dl>
          <div><dt>Messages and files</dt><dd>Server readable</dd></div>
          <div><dt>Device identity verification</dt><dd>Unavailable</dd></div>
          <div><dt>Forward secrecy and recovery</dt><dd>Unavailable</dd></div>
        </dl>
        <p>Voice and video use WebRTC encrypted media transport. Participant accounts are checked by Relaydot, but cryptographic peer identity verification is unavailable.</p>
        <p>Chat PINs limit access on this device. They do not encrypt messages.</p>
      </>}
    </div>
  </GlassDialog>
}
