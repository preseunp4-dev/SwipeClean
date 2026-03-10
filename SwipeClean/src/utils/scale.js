import { Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Reference device: iPhone 13 (390 × 844)
const BASE_W = 390;
const BASE_H = 844;

// Scale factors — capped at 1.15 so tablets don't blow up
const factorW = Math.min(SCREEN_W / BASE_W, 1.15);
const factorH = Math.min(SCREEN_H / BASE_H, 1.15);

/** Scale by screen width — use for horizontal sizes, font sizes, icon sizes */
export const sw = (size) => Math.round(size * factorW);

/** Scale by screen height — use for vertical paddings, spacing */
export const sh = (size) => Math.round(size * factorH);
