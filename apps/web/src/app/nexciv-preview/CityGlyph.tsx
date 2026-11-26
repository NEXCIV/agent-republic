type Glyph = 'places' | 'pulse' | 'coffee' | 'paper' | 'camera';

export function CityGlyph({ name }: { name: Glyph }) {
  const shapes = {
    places: <><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7Z" /><path d="M9 4v13m6-10v13" /></>,
    pulse: <><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="m7 11 2-1 2 2 2-4 2 3h2" /></>,
    coffee: <><path d="M4 9h12v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Zm12 1h2a2 2 0 0 1 0 4h-2M3 20h17M8 3v3m4-3v3" /></>,
    paper: <><path d="M5 3h14v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2Zm3 5h7m-7 4h7m-7 4h4" /></>,
    camera: <><rect x="3" y="6" width="18" height="13" rx="2" /><circle cx="12" cy="12.5" r="3" /><path d="M8 6l1.5-2h5L16 6" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}
