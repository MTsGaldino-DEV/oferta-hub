const KEY = 'hub-theme';

export type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : '';
}

export function applyStoredTheme(): void {
  setTheme(getTheme());
}
