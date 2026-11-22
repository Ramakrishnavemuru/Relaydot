import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Globe2, ShieldCheck } from 'lucide-react'
import { api } from './api'
import { useAuth } from './store'
import type { User } from './types'

const categories = ['Digital Creator', 'Artist', 'Gamer', 'Photographer', 'Educator',
  'Technology', 'Blogger', 'Entrepreneur', 'Other']

export function CreatorAccountPanel({ account }: { account: User }) {
  const client = useQueryClient()
  const setUser = useAuth(state => state.setUser)
  const [category, setCategory] = useState(account.creator_category || 'Digital Creator')
  const [confirmedPublic, setConfirmedPublic] = useState(false)
  const [privateWhenPersonal, setPrivateWhenPersonal] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const switched = useMutation({ mutationFn: (body: object) => api<User>('/creator/account', { method: 'POST', body }),
    onSuccess: user => { setUser(user); client.setQueryData(['settings-me'], user); void client.invalidateQueries({ queryKey: ['profile', user.id] }); setError(''); setNotice(`Switched to ${user.account_type === 'CREATOR' ? 'Creator' : 'Personal'} Account.`) },
    onError: (cause: Error) => setError(cause.message) })
  const configure = useMutation({ mutationFn: (body: object) => api<User>('/creator/profile', { method: 'PATCH', body }),
    onSuccess: user => { setUser(user); client.setQueryData(['settings-me'], user); void client.invalidateQueries({ queryKey: ['profile', user.id] }); setError(''); setNotice('Creator profile updated.') },
    onError: (cause: Error) => setError(cause.message) })
  const creator = account.account_type === 'CREATOR'
  return <section className="settings-panel creator-account-panel"><div className="creator-account-head"><BarChart3 size={24} /><div><h3>Account Type and Tools</h3><p>Choose how you share and understand your work on Relaydot.</p></div></div>
    {notice && <p className="settings-notice" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="creator-account-current"><strong>{creator ? 'Creator Account' : 'Personal Account'}</strong><span>{creator ? 'Public profile · Professional Dashboard enabled' : account.is_private ? 'Private profile' : 'Public profile'}</span></div>
    {!creator ? <><div className="creator-benefits"><p><BarChart3 size={18} /> See real content and audience insights</p><p><Globe2 size={18} /> Share as a public creator</p><p><ShieldCheck size={18} /> Keep your posts, followers, messages and account data</p></div>
      <label className="creator-field">Creator category<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      {account.is_private && <label className="creator-public-confirm"><input type="checkbox" checked={confirmedPublic} onChange={event => setConfirmedPublic(event.target.checked)} /><span>I understand switching to Creator makes my account public. People may see my profile content and followers, subject to each post's audience.</span></label>}
      <button className="button primary" disabled={switched.isPending || (!!account.is_private && !confirmedPublic)} onClick={() => switched.mutate({ account_type: 'CREATOR', category, confirm_public: confirmedPublic })}>Switch to Creator Account <ArrowRight size={17} /></button>
    </> : <><Link className="button primary" to="/professional-dashboard">Open Professional Dashboard <ArrowRight size={17} /></Link><label className="creator-field">Creator category<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><button className="button secondary" disabled={configure.isPending || category === account.creator_category} onClick={() => configure.mutate({ category })}>Save category</button>
      <label className="creator-public-confirm"><input type="checkbox" checked={!!account.creator_contact_enabled} disabled={configure.isPending} onChange={event => configure.mutate({ contact_enabled: event.target.checked })} /><span>Show my registered email as a Contact option on my public profile</span></label>
      <div className="creator-switch-back"><h4>Switch back to Personal</h4><p>Your content and analytics history stay in Relaydot. You can choose a private profile again.</p><label className="creator-public-confirm"><input type="checkbox" checked={privateWhenPersonal} onChange={event => setPrivateWhenPersonal(event.target.checked)} /><span>Make my profile private after switching</span></label><button className="button secondary" disabled={switched.isPending} onClick={() => switched.mutate({ account_type: 'PERSONAL', private_when_personal: privateWhenPersonal })}>Switch to Personal Account</button></div>
    </>}
  </section>
}
