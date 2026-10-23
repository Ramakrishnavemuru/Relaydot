import { useMemo, useState } from 'react'
import { CarFront, Coffee, Flag, Heart, Lightbulb, Search, Smile, Trophy, type LucideIcon } from 'lucide-react'

const sections: { name: string; icon: LucideIcon; emoji: [string, string][] }[] = [
  { name: 'Smileys', icon: Smile, emoji: [
    ['😀', 'grinning face'], ['😃', 'happy face'], ['😄', 'smiling face'], ['😁', 'beaming face'], ['😆', 'laughing'], ['🥹', 'holding back tears'], ['😅', 'sweat smile'], ['😂', 'joy tears'], ['🤣', 'rolling laughing'], ['🙂', 'slight smile'], ['🙃', 'upside down'], ['😉', 'wink'], ['😊', 'blush'], ['😇', 'angel'], ['😍', 'heart eyes'], ['🥰', 'smiling hearts'], ['😘', 'kiss'], ['😗', 'kissing'], ['😋', 'yum'], ['😛', 'tongue'], ['😜', 'winking tongue'], ['🤪', 'zany'], ['🤨', 'raised eyebrow'], ['🧐', 'monocle'], ['🤓', 'nerd'], ['😎', 'cool'], ['🥳', 'party'], ['😏', 'smirk'], ['😔', 'sad'], ['🥺', 'pleading'], ['😭', 'crying'], ['😡', 'angry'], ['😱', 'scream'], ['🤯', 'mind blown'], ['😴', 'sleeping'], ['🤗', 'hug'], ['🤔', 'thinking'], ['🫠', 'melting']
  ] },
  { name: 'People', icon: Heart, emoji: [
    ['👋', 'wave'], ['🤚', 'raised hand'], ['👌', 'okay'], ['✌️', 'peace'], ['🤞', 'fingers crossed'], ['🫶', 'heart hands'], ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['👏', 'clap'], ['🙌', 'raised hands'], ['🤝', 'handshake'], ['🙏', 'thank you'], ['💪', 'strong'], ['👀', 'eyes'], ['❤️', 'red heart'], ['🩷', 'pink heart'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['💔', 'broken heart'], ['💯', 'hundred']
  ] },
  { name: 'Animals', icon: Smile, emoji: [
    ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🦋', 'butterfly'], ['🌸', 'flower'], ['🌹', 'rose'], ['🌻', 'sunflower'], ['🌴', 'palm tree']
  ] },
  { name: 'Food', icon: Coffee, emoji: [
    ['🍎', 'apple'], ['🍓', 'strawberry'], ['🍉', 'watermelon'], ['🍌', 'banana'], ['🥑', 'avocado'], ['🍕', 'pizza'], ['🍔', 'burger'], ['🍟', 'fries'], ['🌮', 'taco'], ['🍜', 'noodles'], ['🍩', 'donut'], ['🍪', 'cookie'], ['🎂', 'cake'], ['☕', 'coffee'], ['🧋', 'bubble tea'], ['🍹', 'drink']
  ] },
  { name: 'Activity', icon: Trophy, emoji: [
    ['⚽', 'football'], ['🏀', 'basketball'], ['🏏', 'cricket'], ['🎾', 'tennis'], ['🏆', 'trophy'], ['🎮', 'game'], ['🎵', 'music'], ['🎤', 'microphone'], ['🎬', 'movie'], ['🎨', 'art'], ['🎉', 'celebration'], ['🎊', 'confetti'], ['🎁', 'gift'], ['✨', 'sparkles'], ['🔥', 'fire'], ['⭐', 'star']
  ] },
  { name: 'Travel', icon: CarFront, emoji: [
    ['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'], ['🚲', 'bike'], ['✈️', 'airplane'], ['🚀', 'rocket'], ['🚂', 'train'], ['🏠', 'house'], ['🏖️', 'beach'], ['⛰️', 'mountain'], ['🌎', 'earth'], ['🌙', 'moon'], ['☀️', 'sun'], ['🌈', 'rainbow']
  ] },
  { name: 'Objects', icon: Lightbulb, emoji: [
    ['💡', 'idea'], ['📱', 'phone'], ['💻', 'computer'], ['📷', 'camera'], ['📚', 'books'], ['✏️', 'pencil'], ['🔑', 'key'], ['🔒', 'lock'], ['💎', 'diamond'], ['💌', 'love letter'], ['🔔', 'bell'], ['🎈', 'balloon']
  ] },
  { name: 'Symbols', icon: Flag, emoji: [
    ['✅', 'check'], ['❌', 'cross'], ['❗', 'exclamation'], ['❓', 'question'], ['➕', 'plus'], ['💬', 'speech bubble'], ['💭', 'thought bubble'], ['🔴', 'red circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'], ['🏳️', 'white flag'], ['🏁', 'finish flag']
  ] },
]

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [category, setCategory] = useState(0)
  const [search, setSearch] = useState('')
  const matches = useMemo(() => search.trim()
    ? sections.flatMap(section => section.emoji).filter(([, name]) => name.includes(search.trim().toLowerCase()))
    : sections[category].emoji, [category, search])

  return <div className="emoji-picker" role="dialog" aria-label="Choose an emoji">
    <label className="emoji-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search emoji" aria-label="Search emoji" /></label>
    <p className="emoji-category-label">{search ? 'Search results' : sections[category].name}</p>
    <div className="emoji-grid">{matches.length ? matches.map(([emoji, name]) => <button type="button" key={`${emoji}-${name}`} title={name} aria-label={name} onClick={() => onSelect(emoji)}>{emoji}</button>) : <p className="emoji-empty">No emoji found</p>}</div>
    <div className="emoji-categories" role="tablist" aria-label="Emoji categories">{sections.map((section, index) => { const Icon = section.icon; return <button type="button" role="tab" aria-selected={index === category && !search} key={section.name} title={section.name} aria-label={section.name} onClick={() => { setSearch(''); setCategory(index) }}><Icon size={18} /></button> })}</div>
  </div>
}
