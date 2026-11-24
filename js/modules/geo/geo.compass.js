import { safeModuleRun } from '../../core/events.js?v=2.9.2-r259';

export const COMPASS_DEADBAND_DEG = 1.8;
export const COMPASS_ROT_DEADBAND_DEG = 1.2;

export function normalizeAngleDeg(deg) {
  return (((Number(deg) || 0) % 360) + 360) % 360;
}

export function shortestAngleDeltaDeg(targetDeg, currentDeg) {
  return ((((Number(targetDeg) || 0) - (Number(currentDeg) || 0)) % 360) + 540) % 360 - 180;
}

export function computeHeadingAngularDiffDeg(aDeg, bDeg) {
  return Math.abs(shortestAngleDeltaDeg(aDeg, bDeg));
}

export function isMapTiltedDeg(rotDeg, thresholdDeg = 1.5) {
  const val = Number(rotDeg) || 0;
  const norm = Math.abs((((val % 360) + 540) % 360) - 180);
  return Math.abs(val % 360) > thresholdDeg && norm < (180 - thresholdDeg);
}

export function rotateScreenDeltaToMap(dx, dy, rotDeg) {
  return safeModuleRun('geo:compass', () => {
    const rad = (-(Number(rotDeg) || 0) * Math.PI) / 180;
    return {
      rx: dx * Math.cos(rad) - dy * Math.sin(rad),
      ry: dx * Math.sin(rad) + dy * Math.cos(rad)
    };
  }, { rx: dx, ry: dy });
}

export function stepCompassLowPass(state, rawDeg, sourceTag = 'rel', currentHeadingDeg = 0) {
  return safeModuleRun('geo:compass', () => {
    const normalizedRaw = normalizeAngleDeg(rawDeg);
    const rad = (normalizedRaw * Math.PI) / 180;
    const wasInitialized = Boolean(state && state.hasSample);
    if (!state.hasSample) {
      state.smoothSin = Math.sin(rad);
      state.smoothCos = Math.cos(rad);
      state.hasSample = true;
    } else {
      const alpha = sourceTag === 'native' ? 0.22 : 0.16;
      state.smoothSin = state.smoothSin * (1 - alpha) + Math.sin(rad) * alpha;
      state.smoothCos = state.smoothCos * (1 - alpha) + Math.cos(rad) * alpha;
    }
    const smoothed = ((Math.atan2(state.smoothSin, state.smoothCos) * 180) / Math.PI + 360) % 360;
    const angularDiff = Math.abs((((smoothed - currentHeadingDeg) % 360) + 540) % 360 - 180);
    if (wasInitialized && angularDiff < COMPASS_DEADBAND_DEG) {
      return { updated: false, headingDeg: currentHeadingDeg, smoothedDeg: smoothed, angularDiff };
    }
    return { updated: true, headingDeg: Math.round(smoothed) % 360, smoothedDeg: smoothed, angularDiff };
  }, { updated: false, headingDeg: currentHeadingDeg, smoothedDeg: currentHeadingDeg, angularDiff: 0 });
}

export function computeMapRotationStep({
  curRotDeg,
  headingDeg = 0,
  compassActive = false,
  manualDegDelta = null,
  instant = false,
  userManualRotatedMap = false,
  isCompassMode = false
}) {
  return safeModuleRun('geo:compass', () => {
    const cur = Number(curRotDeg) || 0;
    if (manualDegDelta !== null) {
      return { changed: true, nextRotDeg: cur + (Number(manualDegDelta) || 0) };
    }
    if (compassActive) {
      const target = -((Number(headingDeg) || 0) % 360);
      const delta = ((((target - cur) % 360) + 540) % 360) - 180;
      if (!instant && Math.abs(delta) < COMPASS_ROT_DEADBAND_DEG) {
        return { changed: false, nextRotDeg: cur };
      }
      return { changed: true, nextRotDeg: cur + (instant ? delta : delta * 0.35) };
    }
    if (!isCompassMode && !userManualRotatedMap && Math.abs(cur % 360) <= 1.5) {
      return { changed: true, nextRotDeg: 0 };
    }
    return { changed: false, nextRotDeg: cur };
  }, { changed: false, nextRotDeg: Number(curRotDeg) || 0 });
}

export function stabilizeOverlayElement(el, rotDeg) {
  return safeModuleRun('geo:compass', () => {
    if (!el || !el.classList || Math.abs((Number(rotDeg) || 0) % 360) <= 0.1) return;
    const invDegStr = `${(-(Number(rotDeg) || 0)).toFixed(2)}deg`;
    if (el.classList.contains('leaflet-popup')) {
      el.style.transformOrigin = '50% calc(100% + 13px)';
      const baseTr = String(el.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '').trim();
      el.style.transform = baseTr ? `${baseTr} rotate(${invDegStr})` : `rotate(${invDegStr})`;
    } else if (el.classList.contains('leaflet-tooltip')) {
      el.style.transformOrigin = '50% 50%';
      const baseTr = String(el.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '').trim();
      el.style.transform = baseTr ? `${baseTr} rotate(${invDegStr})` : `rotate(${invDegStr})`;
    }
  });
}

export function stabilizeMapOverlaysInBox(box, rotDeg) {
  return safeModuleRun('geo:compass', () => {
    if (!box) return;
    const deg = Number(rotDeg) || 0;
    const invDegStr = `${(-deg).toFixed(2)}deg`;
    const inv = `rotate(${invDegStr})`;
    box.style.transition = 'none';
    box.style.transform = `rotate(${deg.toFixed(2)}deg)`;
    box.style.setProperty('--klev-inv-rot', invDegStr);
    box.querySelectorAll('.klev-map-pin-rot-inner').forEach(el => {
      el.style.transform = inv;
    });
    box.querySelectorAll('.leaflet-popup').forEach(pop => {
      pop.style.transformOrigin = '50% calc(100% + 13px)';
      const baseTr = String(pop.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '').trim();
      pop.style.transform = baseTr ? `${baseTr} ${inv}` : inv;
    });
    box.querySelectorAll('.leaflet-tooltip').forEach(tt => {
      tt.style.transformOrigin = '50% 50%';
      const baseTr = String(tt.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '').trim();
      tt.style.transform = baseTr ? `${baseTr} ${inv}` : inv;
    });
  });
}
