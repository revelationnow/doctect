import React from 'react';
import { useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { trackEvent } from '../services/analytics';
import { isSameRouteNavigation, overlayDepthOf } from './editor-layout/useBackDismiss';

/**
 * Records a `page_view` for every router location, as the app always has, with one exception:
 * the touch editor's overlay entries. Those are the same URL with a marker in `location.state`,
 * and neither pushing one nor popping back off one is a page view. Everything else, same-URL
 * replace navigations included, is tracked exactly as before.
 */
export function PageTracker() {
  const location = useLocation();
  const previous = React.useRef<Location | null>(null);
  React.useEffect(() => {
    const prior = previous.current;
    previous.current = location;
    const overlayHop = prior !== null && isSameRouteNavigation(prior, location)
      && (overlayDepthOf(location) > 0 || overlayDepthOf(prior) > 0);
    if (overlayHop) return;
    trackEvent('page_view', { path: location.pathname });
  }, [location]);
  return null;
}
