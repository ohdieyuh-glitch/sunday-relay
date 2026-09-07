/**
 * THE WONDERLAND USAGE HUD — the website's presenter for the top-left meter.
 *
 * A consumer of `mission/wonderland/wonderland-usage-meter` and of nothing
 * else: the domain owns the numbers, the palette and the curve, and Unreal
 * reads the same struct. This barrel exists so a surface mounts the HUD by
 * name rather than by path.
 */
export { WonderlandUsageHudView } from './WonderlandUsageHudView';
