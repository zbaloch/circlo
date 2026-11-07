import { Intro } from '@/components/intro';

/**
 * The first screen when signed out: the intro (what Circlo is, why, and how), ending with Create account and Log in.
 * The first launch starts at the beginning; later ones open on the last screen.
 */
export default function WelcomeScreen() {
  return <Intro mode="start" />;
}
