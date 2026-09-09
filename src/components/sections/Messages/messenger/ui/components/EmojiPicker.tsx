import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SearchField } from "@ui";
import { X } from "./icons";
import "./EmojiPicker.css";

type EmojiItem = readonly [symbol: string, name: string];
interface EmojiGroup { id: string; label: string; marker: string; items: readonly EmojiItem[] }

const RECENT_KEY = "siomac:messenger:recent-emojis";
const groups: readonly EmojiGroup[] = [
  { id: "smileys", label: "Smileys & Emotion", marker: "🙂", items: [
    ["😀","grinning face"],["😃","smiling face big eyes"],["😄","smiling face"],["😁","beaming face"],["😆","laughing squinting"],["😅","sweat smile"],["😂","tears of joy"],["🤣","rolling laughing"],["😊","blush smile"],["🙂","slightly smiling"],["🙃","upside down"],["😉","wink"],["😍","heart eyes"],["🥰","smiling hearts"],["😘","kiss"],["😎","cool sunglasses"],["🤩","star struck"],["🥳","party face"],["😇","angel halo"],["🤔","thinking"],["🫡","salute"],["🤨","raised eyebrow"],["😐","neutral"],["😶","speechless"],["🙄","rolling eyes"],["😏","smirk"],["😴","sleeping"],["🤤","drooling"],["😢","crying"],["😭","loud crying"],["😤","triumph"],["😡","angry"],["🤯","mind blown"],["😱","screaming"],["😬","grimace"],["🫠","melting"],["❤️","red heart"],["🧡","orange heart"],["💛","yellow heart"],["💚","green heart"],["💙","blue heart"],["💜","purple heart"],["🤍","white heart"],["💔","broken heart"],["💯","hundred"],["💥","collision"],["✨","sparkles"],["💬","speech bubble"]
  ]},
  { id: "people", label: "People & Gestures", marker: "👋", items: [
    ["👋","waving hand"],["🤚","raised back hand"],["🖐️","hand fingers splayed"],["✋","raised hand"],["👌","ok hand"],["🤌","pinched fingers"],["🤏","pinching hand"],["✌️","victory hand"],["🤞","crossed fingers"],["🫰","hand heart"],["🤟","love you gesture"],["🤘","rock on"],["🤙","call me hand"],["👈","point left"],["👉","point right"],["👆","point up"],["👇","point down"],["☝️","index pointing up"],["👍","thumbs up like"],["👎","thumbs down dislike"],["✊","raised fist"],["👊","fist bump"],["👏","clapping hands"],["🙌","raising hands"],["🫶","heart hands"],["🙏","folded hands thanks"],["🤝","handshake agreement"],["💪","flexed biceps strength"],["👀","eyes looking"],["🧠","brain"],["👤","person silhouette"],["👥","people group"],["🧑‍💻","technologist"],["👷","construction worker"],["🧑‍🔧","mechanic"],["🧑‍🚒","firefighter"],["🧑‍⚕️","health worker"],["🧑‍🏫","teacher"],["🧑‍💼","office worker"],["🧑‍🔬","scientist"]
  ]},
  { id: "animals", label: "Animals & Nature", marker: "🐾", items: [
    ["🐶","dog"],["🐱","cat"],["🐭","mouse"],["🐹","hamster"],["🐰","rabbit"],["🦊","fox"],["🐻","bear"],["🐼","panda"],["🐨","koala"],["🐯","tiger"],["🦁","lion"],["🐮","cow"],["🐷","pig"],["🐸","frog"],["🐵","monkey"],["🐔","chicken"],["🐧","penguin"],["🐦","bird"],["🦅","eagle"],["🦆","duck"],["🦉","owl"],["🐝","bee"],["🦋","butterfly"],["🐢","turtle"],["🐬","dolphin"],["🌱","seedling"],["🌿","herb"],["🍀","four leaf clover"],["🌳","tree"],["🌵","cactus"],["🌸","cherry blossom"],["🌻","sunflower"],["🌞","sun face"],["🌙","moon"],["⭐","star"],["🌈","rainbow"],["🔥","fire"],["💧","water drop"],["🌊","wave"],["⚡","lightning"]
  ]},
  { id: "food", label: "Food & Drink", marker: "☕", items: [
    ["🍎","apple"],["🍊","orange"],["🍋","lemon"],["🍌","banana"],["🍉","watermelon"],["🍇","grapes"],["🍓","strawberry"],["🍒","cherries"],["🥭","mango"],["🍍","pineapple"],["🥑","avocado"],["🥕","carrot"],["🌽","corn"],["🍞","bread"],["🥐","croissant"],["🧀","cheese"],["🍳","cooking egg"],["🍔","burger"],["🍕","pizza"],["🥗","salad"],["🍜","noodles"],["🍣","sushi"],["🍪","cookie"],["🎂","birthday cake"],["🍫","chocolate"],["☕","coffee"],["🍵","tea"],["🥤","cup straw"],["🧃","juice box"],["💧","water"]
  ]},
  { id: "activity", label: "Activity", marker: "⚽", items: [
    ["⚽","soccer"],["🏀","basketball"],["🏈","football"],["⚾","baseball"],["🎾","tennis"],["🏐","volleyball"],["🏓","table tennis"],["🏸","badminton"],["🥊","boxing"],["🏆","trophy"],["🥇","gold medal"],["🎯","target"],["🎮","video game"],["🎲","game die"],["🎨","artist palette"],["🎭","theater"],["🎤","microphone"],["🎧","headphones"],["🎸","guitar"],["🎹","piano"],["🎬","film clapper"],["📸","camera flash"],["🎉","party popper"],["🎊","confetti"]
  ]},
  { id: "travel", label: "Travel & Places", marker: "🚗", items: [
    ["🚗","car"],["🚕","taxi"],["🚌","bus"],["🚑","ambulance"],["🚒","fire engine"],["🚚","delivery truck"],["🚜","tractor"],["🏍️","motorcycle"],["🚲","bicycle"],["✈️","airplane"],["🚁","helicopter"],["🚀","rocket"],["🚢","ship"],["⚓","anchor"],["⛽","fuel pump"],["🚧","construction"],["🏠","house"],["🏢","office building"],["🏭","factory"],["🏥","hospital"],["🏗️","building construction"],["🌍","earth globe"],["🗺️","world map"],["📍","location pin"],["🧭","compass"],["⏱️","stopwatch"],["🌅","sunrise"],["🌃","night city"]
  ]},
  { id: "objects", label: "Objects", marker: "💡", items: [
    ["⌚","watch"],["📱","mobile phone"],["💻","laptop"],["⌨️","keyboard"],["🖥️","desktop computer"],["🖨️","printer"],["📷","camera"],["💡","light bulb idea"],["🔦","flashlight"],["📕","red book"],["📚","books"],["📄","document page"],["📊","bar chart"],["📈","chart increasing"],["📉","chart decreasing"],["📋","clipboard"],["📌","pushpin"],["📎","paperclip"],["✂️","scissors"],["🔒","locked secure"],["🔑","key"],["🔧","wrench"],["🔨","hammer"],["🛠️","tools"],["⚙️","gear settings"],["🧰","toolbox"],["🧯","fire extinguisher"],["🦺","safety vest"],["⛑️","rescue helmet"],["🔔","bell notification"],["📣","megaphone"],["✉️","email envelope"],["📦","package"],["🗂️","card index"],["🗓️","calendar"],["🕐","clock"]
  ]},
  { id: "symbols", label: "Symbols", marker: "✅", items: [
    ["✅","check mark complete"],["☑️","checkbox"],["✔️","check"],["❌","cross mark"],["❎","cross button"],["⚠️","warning"],["🚫","prohibited"],["🛑","stop sign"],["❗","exclamation"],["❓","question"],["‼️","double exclamation"],["💲","dollar sign"],["➕","plus"],["➖","minus"],["➗","divide"],["♻️","recycle"],["🔄","refresh"],["🔴","red circle"],["🟠","orange circle"],["🟡","yellow circle"],["🟢","green circle"],["🔵","blue circle"],["🟣","purple circle"],["⚫","black circle"],["⚪","white circle"],["🔺","red triangle"],["🔻","down triangle"],["🔷","blue diamond"],["🔶","orange diamond"],["▶️","play"],["⏸️","pause"],["⏹️","stop"],["➡️","right arrow"],["⬅️","left arrow"],["⬆️","up arrow"],["⬇️","down arrow"]
  ]},
  { id: "flags", label: "Flags", marker: "🏳️", items: [
    ["🏁","chequered flag"],["🚩","triangular flag"],["🏳️","white flag"],["🏴","black flag"],["🇦🇷","flag argentina"],["🇦🇺","flag australia"],["🇧🇷","flag brazil"],["🇨🇦","flag canada"],["🇨🇱","flag chile"],["🇨🇳","flag china"],["🇨🇴","flag colombia"],["🇫🇷","flag france"],["🇩🇪","flag germany"],["🇮🇳","flag india"],["🇮🇹","flag italy"],["🇯🇵","flag japan"],["🇲🇽","flag mexico"],["🇳🇬","flag nigeria"],["🇵🇪","flag peru"],["🇿🇦","flag south africa"],["🇪🇸","flag spain"],["🇬🇧","flag united kingdom"],["🇺🇸","flag united states"],["🇻🇪","flag venezuela"]
  ]},
] as const;
const defaultGroup = groups[0]!;

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 24) : [];
  } catch { return []; }
}

export function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState(defaultGroup.id);
  const [recent, setRecent] = useState<string[]>(readRecent);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[aria-label="Choose emoji"]')) return;
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    return groups.flatMap((group) => group.items).filter(([symbol, name]) => symbol.includes(normalized) || name.includes(normalized));
  }, [query]);
  const visibleGroup = groups.find((group) => group.id === activeGroup) ?? defaultGroup;
  const recentItems: EmojiItem[] = recent.map((symbol) => [symbol, "recent emoji"] as const);

  const choose = (symbol: string) => {
    const next = [symbol, ...recent.filter((item) => item !== symbol)].slice(0, 24);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage can be unavailable in protected sessions */ }
    onSelect(symbol);
  };

  const renderGrid = (items: readonly EmojiItem[]) => <div className="sm-emoji-picker__grid" role="grid">
    {items.map(([symbol, name]) => <button type="button" role="gridcell" key={`${symbol}-${name}`} title={name} aria-label={name} onClick={() => choose(symbol)}>{symbol}</button>)}
  </div>;

  return <div ref={rootRef} className="sm-emoji-picker" role="dialog" aria-label="Emoji picker">
    <header className="sm-emoji-picker__header">
      <strong>Emoji</strong>
      <button type="button" aria-label="Close emoji picker" onClick={onClose}><X /></button>
    </header>
    <SearchField class="sm-emoji-picker__search" size="sm" autoFocus value={query} placeholder="Search Emoji" aria-label="Search emoji" onInput={setQuery} />
    <nav className="sm-emoji-picker__categories" aria-label="Emoji categories">
      {groups.map((group) => <button type="button" className={activeGroup === group.id && !query ? "is-active" : ""} aria-label={group.label} title={group.label} onClick={() => { setQuery(""); setActiveGroup(group.id); }}>{group.marker}</button>)}
    </nav>
    <div className="sm-emoji-picker__content">
      {searchResults ? <section><h4>Search Results</h4>{searchResults.length ? renderGrid(searchResults) : <p className="sm-emoji-picker__empty">No emoji found.</p>}</section> : <>
        {recentItems.length ? <section><h4>Recently Used</h4>{renderGrid(recentItems)}</section> : null}
        <section><h4>{visibleGroup.label}</h4>{renderGrid(visibleGroup.items)}</section>
      </>}
    </div>
  </div>;
}
