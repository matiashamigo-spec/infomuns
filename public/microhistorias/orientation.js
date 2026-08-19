export function isPortrait(mediaQueryList) {
  return !!(mediaQueryList && mediaQueryList.matches);
}

export function watchOrientation(onChange) {
  const mql = window.matchMedia('(orientation: portrait)');
  const handleChange = () => onChange(isPortrait(mql));
  handleChange();
  mql.addEventListener('change', handleChange);
  return function unwatch() {
    mql.removeEventListener('change', handleChange);
  };
}
