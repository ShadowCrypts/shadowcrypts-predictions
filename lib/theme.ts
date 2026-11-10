export const THEME_KEY = 'sc-theme';

/** Runs before first paint (inlined in <head>) so the saved theme never flashes. */
export const themeScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
