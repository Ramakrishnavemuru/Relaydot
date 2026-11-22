import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Bookmark, Eye, Heart, MessageCircle, Repeat2, Send } from 'lucide-react'
import { api, mediaUrl, query } from '../api'
import { ErrorBox, Shell } from '../components'
import { Trend } from './ProfessionalDashboardPage'

type Window = 'FIRST_24H' | '7D' | '30D' | '90D' | 'LIFETIME'
type Tab = 'overview' | 'engagement' | 'audience'
type Rate = { value: number | null; formula: string } | null
type Report = {
  kind: 'POST' | 'REEL'; id: number; preview: string; media_url?: string; url: string; published_at: string; note: string;
  audience_min: number; audience: { followers: number; non_followers: number; unknown: number } | null;
  metrics: { views: number; reach: number; likes: number; comments: number; shares: number; reposts: number | null;
    saves: number; follows: number; profile_visits: number | null; interactions: number; engagement_rate: number | null };
  rates: Record<string, Rate>;
  watch: { starts: number; total_watch_ms: number; average_watch_ms: number | null; skips: number; completed: number; replays: number } | null;
  trend: { date: string; views: number; engagements: number }[];
}
type StoryReport = { preview: string; views: number; unique_viewers: number; note: string }
const fmt = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString()
const percent = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toFixed(1) + '%'
const watchTime = (value: number | null | undefined) => value == null ? 'Unavailable' : (value / 1000).toFixed(1) + 's'
function Metric({ label, value, help }: { label: string; value: string; help?: string }) {
  return <article className="insight-metric" title={help}><span>{label}</span><strong>{value}</strong>{help && <small>{help}</small>}</article>
}
function RateRow({ label, rate }: { label: string; rate: Rate }) {
  if (!rate) return null
  return <div className="insight-rate" title={rate.formula}><span>{label}<small>{rate.formula}</small></span><strong>{percent(rate.value)}</strong></div>
}
export function ContentInsightPage() {
  const { kind, id } = useParams()
  const [window, setWindow] = useState<Window>('30D')
  const [tab, setTab] = useState<Tab>('overview')
  const isStory = kind === 'STORY'
  const report = useQuery({ queryKey: ['content-insight-detail', kind, id, window],
    queryFn: () => api<Report>(query('/creator/insights/' + kind + '/' + id + '/detail', { window })), enabled: !!kind && !!id && !isStory })
  const story = useQuery({ queryKey: ['creator-story-insight', id],
    queryFn: () => api<StoryReport>(query('/creator/insights/STORY/' + id, { days: 30 })), enabled: !!id && isStory })
  const data = report.data, metrics = data?.metrics
  return <Shell active="Profile"><main className="creator-dashboard insight-page">
    <header className="insight-header"><Link to="/professional-dashboard" aria-label="Back to Professional Dashboard"><ArrowLeft size={20} /></Link><div><small>CONTENT INSIGHTS</small><h1>{kind === 'REEL' ? 'Reel insights' : kind === 'STORY' ? 'Story insights' : 'Post insights'}</h1></div><BarChart3 size={21} aria-hidden="true" /></header>
    {isStory ? <>{story.isPending && <div className="insight-skeleton" aria-label="Loading insights" />}{story.error && <ErrorBox error={story.error} retry={() => void story.refetch()} />}{story.data && <section className="creator-section"><p>{story.data.preview}</p><div className="insight-metrics"><Metric label="Views" value={fmt(story.data.views)} /><Metric label="Unique viewers" value={fmt(story.data.unique_viewers)} /></div><p className="creator-data-note">{story.data.note}</p></section>}</> : <>
      <div className="insight-period"><label htmlFor="insight-window">Period</label><select id="insight-window" value={window} onChange={event => setWindow(event.target.value as Window)}><option value="FIRST_24H">First 24 hours</option><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option><option value="90D">Last 90 days</option><option value="LIFETIME">Lifetime</option></select></div>
      {report.isPending && <div className="insight-skeleton" aria-label="Loading insights" />}{report.error && <ErrorBox error={report.error} retry={() => void report.refetch()} />}
      {data && metrics && <><section className="insight-content"><div className="insight-preview">{data.media_url && <img src={mediaUrl(data.media_url)} alt="Content preview" loading="lazy" />}<div><span>{data.kind} · {new Date(data.published_at).toLocaleDateString()}</span><h2>{data.preview}</h2><Link to={data.url}>View content</Link></div></div><div className="insight-interactions" aria-label="Current interactions"><span><Heart size={17} />{fmt(metrics.likes)}</span><span><MessageCircle size={17} />{fmt(metrics.comments)}</span>{metrics.reposts != null && <span><Repeat2 size={17} />{fmt(metrics.reposts)}</span>}<span><Send size={17} />{fmt(metrics.shares)}</span><span><Bookmark size={17} />{fmt(metrics.saves)}</span></div></section>
        <div className="insight-tabs" role="tablist" aria-label="Insight sections">{(['overview', 'engagement', 'audience'] as const).map(name => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
        {tab === 'overview' && <section className="creator-section" role="tabpanel"><h2>Overview</h2><div className="insight-metrics"><Metric label="Qualified views" value={fmt(metrics.views)} help={data.kind === 'REEL' ? 'At least 3 seconds of recorded playback; one view per account per 24 hours.' : 'At least one second with half the post visible; repeat views are deduplicated.'} /><Metric label="Accounts reached" value={fmt(metrics.reach)} help="Distinct signed-in accounts with a recorded view." />{data.kind === 'REEL' && <Metric label="Average watch time" value={watchTime(data.watch?.average_watch_ms)} help="Recorded watch time divided by playback starts since tracking began." />}<Metric label="Follows" value={fmt(metrics.follows)} help="Follows made from this content's Follow action." /></div><h3>What affects your views</h3><div className="insight-rates">{data.kind === 'REEL' && <RateRow label="Skip rate" rate={data.rates.skip} />}{[['Share rate', 'share'], ['Like rate', 'like'], ['Save rate', 'save'], ['Repost rate', 'repost'], ['Comment rate', 'comment']].map(([label, key]) => <RateRow key={key} label={label} rate={data.rates[key]} />)}{data.kind === 'REEL' && <RateRow label="Completion rate" rate={data.rates.completion} />}</div><p className="creator-data-note">Rates describe recorded Relaydot activity, not a recommendation score.</p></section>}
        {tab === 'engagement' && <section className="creator-section" role="tabpanel"><h2>Engagement</h2><div className="insight-metrics"><Metric label="Interactions" value={fmt(metrics.interactions)} /><Metric label="Engagement rate" value={percent(metrics.engagement_rate)} help="Current likes, comments, shares, saves and reposts divided by qualified views." /><Metric label="Shares" value={fmt(metrics.shares)} /><Metric label="Saves" value={fmt(metrics.saves)} /></div><div className="creator-graph-panel"><h3>Daily engagements</h3><Trend points={data.trend.map(point => ({ date: point.date, value: point.engagements }))} label="Daily engagements" /></div>{data.kind === 'REEL' && data.watch && <div className="insight-metrics"><Metric label="Playback starts" value={fmt(data.watch.starts)} /><Metric label="Completed sessions" value={fmt(data.watch.completed)} /><Metric label="Early exits" value={fmt(data.watch.skips)} /><Metric label="Replays" value={fmt(data.watch.replays)} /><Metric label="Total watch time" value={watchTime(data.watch.total_watch_ms)} /></div>}<p className="creator-data-note">Interaction totals reflect currently retained actions created in this period. Removed likes, saves and comments are excluded.</p></section>}
        {tab === 'audience' && <section className="creator-section" role="tabpanel"><h2>Audience</h2><div className="insight-metrics"><Metric label="Accounts reached" value={fmt(metrics.reach)} /><Metric label="Follows from content" value={fmt(metrics.follows)} /><Metric label="Profile visits from content" value={fmt(metrics.profile_visits)} /></div><div className="creator-graph-panel"><h3>Daily views</h3><Trend points={data.trend.map(point => ({ date: point.date, value: point.views }))} label="Daily content views" /></div>{data.audience ? <div className="insight-audience"><div><Eye size={18} /><span>Followers</span><strong>{fmt(data.audience.followers)} · {percent(100 * data.audience.followers / metrics.reach)}</strong></div><div><Eye size={18} /><span>Non-followers</span><strong>{fmt(data.audience.non_followers)} · {percent(100 * data.audience.non_followers / metrics.reach)}</strong></div>{data.audience.unknown > 0 && <div><span>Unknown at view time</span><strong>{fmt(data.audience.unknown)}</strong></div>}</div> : <p className="creator-data-note">Audience breakdown appears after {data.audience_min} accounts are reached.</p>}<p className="creator-data-note">Age, gender and location breakdowns are unavailable because Relaydot does not collect this information for insights.</p></section>}
        <p className="creator-data-note insight-footnote">{data.note}</p></>}
    </>}
  </main></Shell>
}
