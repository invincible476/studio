
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Use a more generic name for the hook
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, [matches, query]);
  return matches;
}

interface MobileDesignContextType {
  isMobileDesign: boolean;
  setIsMobileDesign: (isMobile: boolean) => void;
  isMobileView: boolean;
  height: number;
}

const MobileDesignContext = createContext<MobileDesignContextType | undefined>(undefined);

export function MobileProvider({ children }: { children: ReactNode }) {
  const [isMobileDesign, setMobileDesignState] = useState(true);
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const savedMobileDesign = localStorage.getItem('mobile_redesign');
    const isEnabled = savedMobileDesign !== null ? savedMobileDesign === 'true' : true;
    
    setMobileDesignState(isEnabled);
    document.body.dataset.mobile = isEnabled ? "true" : "false";

    const handleResize = () => {
      // Use visualViewport on mobile for better accuracy with virtual keyboard
      const newHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setHeight(newHeight);
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    } else {
      window.addEventListener('resize', handleResize);
    }
    handleResize(); // Initial call
    
    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      } else {
        window.removeEventListener('resize', handleResize);
      }
    };

  }, []);

  const setIsMobileDesign = (enabled: boolean) => {
    setMobileDesignState(enabled);
    localStorage.setItem('mobile_redesign', String(enabled));
    document.body.dataset.mobile = enabled ? "true" : "false";
  };

  const isMobileView = isMobile && isMobileDesign;

  return (
    <MobileDesignContext.Provider value={{ isMobileDesign, setIsMobileDesign, isMobileView, height }}>
      {children}
    </MobileDesignContext.Provider>
  );
}

export function useMobileDesign() {
  const context = useContext(MobileDesignContext);
  if (context === undefined) {
    throw new Error('useMobileDesign must be used within a MobileProvider');
  }
  return context;
}
