import { useEffect, useState } from 'react';

/* 860px pra bater com o breakpoint que o resto do app ja usa (styles.css
   @media max-width: 860px) -- mantem a pagina inteira mudando de modo
   mobile no mesmo ponto, sidebar incluida. */
const MOBILE_BREAKPOINT = 860;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
