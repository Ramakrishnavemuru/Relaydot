import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Compass, Hash, MessageCircle, PlaySquare, Search, Users } from 'lucide-react'
import { api, query } from '../api'
import { Avatar, ErrorBox, Shell } from '../components'
import { PostCard } from './FeedPage'
import type { Page, SearchResult } from '../types'

type DiscoveryCommunity = { id: number; name: string; description: string; member_count: number }
type TrendingTopic = { name: string; posts: number; recent_posts: number }
const postCount = (count: number) => `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'post' : 'posts'}`

function TrendingTopics({ topics, compact = false }: { topics: TrendingTopic[]; compact?: boolean }) {
  const hasRecent = topics.some(topic => topic.recent_posts > 0)
  return <section className={compact ? 'result-section explore-trending-results' : 'discover-section'}>
    <h2><Hash size={19} /> {hasRecent ? 'Trending topics' : 'Popular topics'}</h2>
    {topics.length ? <div className="discover-topics">{topics.map((topic, index) => <Link key={topic.name} to={`/topics/${encodeURIComponent(topic.name)}`}><span className="topic-rank">{String(index + 1).padStart(2, '0')} · {topic.recent_posts > 0 ? 'Trending now' : 'Popular hashtag'}</span><strong>#{topic.name}</strong><small>{postCount(topic.posts)} total</small><ArrowUpRight size={17} /></Link>)}</div> : <p className="explore-empty-inline">No public hashtag posts yet. Topics will appear as people post.</p>}
  </section>
}

export function ExplorePage() {
  const [input, setInput] = useState('')
  const term = input.trim()
  const results = useQuery({ queryKey: ['search', term], queryFn: () => api<SearchResult>(query('/social/search', { q: term, limit: 15 })), enabled: !!term })
  const trending = useQuery({ queryKey: ['trending'], queryFn: () => api<TrendingTopic[]>('/social/trending') })
  const communities = useQuery({ queryKey: ['explore-communities'], queryFn: () => api<Page<DiscoveryCommunity>>(query('/social/communities', { limit: 3 })), enabled: !term })

  return <Shell active="Explore">
    <header className="page-header"><h1>Explore</h1></header>
    <label className="explore-search"><Search size={20} /><input autoFocus value={input} onChange={event => setInput(event.target.value)} placeholder="Search people, posts, hashtags, communities" aria-label="Search Relay" /></label>
    {!term && <div className="explore-discover">
      <section className="explore-hero"><span><Compass size={18} /> YOUR DISCOVERY SPACE</span><h2>Find your next favorite thing.</h2><p>Explore conversations, communities, and stories from across Relay.</p></section>
      <div className="explore-shortcuts"><Link to="/reels"><PlaySquare size={23} /><strong>Watch Reels</strong><small>See what people are sharing</small><ArrowUpRight size={18} /></Link><Link to="/communities"><Users size={23} /><strong>Communities</strong><small>Find people who get you</small><ArrowUpRight size={18} /></Link><Link to="/chats"><MessageCircle size={23} /><strong>Messages</strong><small>Pick up a conversation</small><ArrowUpRight size={18} /></Link></div>
      {trending.error ? <ErrorBox error={trending.error} retry={() => void trending.refetch()} /> : <TrendingTopics topics={trending.data || []} />}
      {!!communities.data?.items.length && <section className="discover-section"><h2><Users size={19} /> Communities to explore</h2><div className="discover-communities">{communities.data.items.map(community => <Link key={community.id} to={`/communities/${community.id}`}><strong>{community.name}</strong><small>{community.description || `${community.member_count} members`}</small><ArrowUpRight size={18} /></Link>)}</div></section>}
    </div>}
    {results.isPending && term && <div className="loading-list">Searching…</div>}
    {results.error && <ErrorBox error={results.error} />}
    {results.data && term && <>
      <section className="result-section"><h2>People</h2>{results.data.people.length ? results.data.people.map(person => <Link className="person-row" key={person.id} to={`/profile/${person.id}`}><Avatar user={person} /><span><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></Link>) : <p className="muted">No people found.</p>}</section>
      <section className="result-section"><h2>Hashtags matching “{term}”</h2>{results.data.topics.length ? <div className="topic-list">{results.data.topics.map(topic => <Link key={topic.name} to={`/topics/${encodeURIComponent(topic.name)}`}><Hash size={19} /><span><strong>#{topic.name}</strong><small>{postCount(topic.posts)} total</small></span><ArrowUpRight size={17} /></Link>)}</div> : <p className="muted">No matching hashtags.</p>}</section>
      {trending.error ? <ErrorBox error={trending.error} retry={() => void trending.refetch()} /> : <TrendingTopics topics={trending.data || []} compact />}
      <section className="result-section"><h2>Posts</h2>{results.data.posts.length ? results.data.posts.map(post => <PostCard key={post.id} post={post} />) : <p className="muted">No matching posts.</p>}</section>
      <section className="result-section"><h2>Communities</h2>{results.data.communities.length ? results.data.communities.map(community => <Link className="community-result" key={community.id} to={`/communities/${community.id}`}><strong>{community.name}</strong><p>{community.description}</p><small>{community.member_count} members</small></Link>) : <p className="muted">No matching communities.</p>}</section>
    </>}
  </Shell>
}
