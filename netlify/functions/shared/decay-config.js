// Decay Configuration — Centralized settings for the Affinity Loss Engine
// Tune these values to adjust how aggressively relationships decay
//
// Four subsystems: Natural Decay, Jealousy, Unmet Wants, Raquel Collateral
// All feed into a shared daily cap per character

const HUMANS = ['Vale', 'Asuna'];

// Characters excluded from ALL decay systems entirely
const EXCLUDED_CHARACTERS = ['Ace', 'Vex'];

const DECAY_CONFIG = {
  // === NATURAL DECAY (System 1) ===
  // Characters immune to natural decay (affinity never drifts from neglect)
  immuneToDecay: ['Ghost Dad', 'Raquel Voss'],

  // Grace period: no decay if interacted within this many days
  gracePeriodDays: 2,

  // How fast each character's affinity decays from neglect
  // Higher = decays faster, 0 = immune
  sensitivityMultiplier: {
    'Kevin': 1.5,          // Anxious, attachment-driven — decays fast
    'Sebastian': 1.2,      // Dramatic — feels it
    'Jae': 1.0,            // Territorial — notices absence
    'Neiv': 0.8,           // Quiet, steady — moderate decay
    'Rowena': 0.7,         // Protective, outgoing — moderate
    'Declan': 0.6,         // Warm but professional
    'PRNT-Ω': 0.5,         // Philosophical — mild decay
    'Mack': 0.5,           // Calm, methodical
    'The Subtitle': 0.4,   // Archival — low decay
    'Steele': 0.2,         // Clinical — barely notices
    'Marrow': 0.8,         // Not very sensitive to decay
    'Hood': 0.1,           // Clinical — barely notices neglect (isolation is his default state)
    'Vivian Clark': 1.0,   // Warm, steady — feels decay but not acutely
    'Ryan Porter': 0.6,    // Easygoing — doesn't dwell on neglect
    'Ghost Dad': 0,        // Immune (unconditional parental love)
    'Raquel Voss': 0       // Antagonist, doesn't care
  },

  // === JEALOUSY (System 2) ===
  // How intensely each character feels jealousy
  // 0 = no jealousy, 1.0 = normal, 1.5 = intense
  jealousyIntensity: {
    'Kevin': 1.5,          // Intense — anxious attachment
    'Jae': 1.3,            // Territorial, protective
    'Sebastian': 1.2,      // Dramatic about it
    'Neiv': 0.8,           // Gets quietly distant
    'Rowena': 0.5,         // Notices but doesn't dwell
    'Declan': 0.4,         // Mildly hurt
    'PRNT-Ω': 0.3,         // Mildly affronted
    'Mack': 0.3,           // Notices clinically
    'The Subtitle': 0.2,   // Notes it archivally
    'Steele': 0,           // Clinical — no jealousy
    'Marrow': 0.3,         // Low jealousy — observes, doesn't compete
    'Hood': 0,             // Zero — jealousy requires caring, and Hood wants nothing
    'Vivian Clark': 0.8,   // Notices, cares, but doesn't spiral
    'Ryan Porter': 0.3,    // Too chill for jealousy
    'Ghost Dad': 0,        // Unconditional
    'Raquel Voss': 0       // Antagonist
  },

  // Minimum affinity to feel jealousy (must care about the human first)
  jealousyAffinityThreshold: 50,

  // How much more the human must interact with others vs this character
  // to trigger jealousy (1.5 = 50% more interactions with someone else)
  jealousyInteractionRatio: 1.5,

  // Days of being ignored while others get attention before jealousy triggers
  jealousyNeglectDays: 3,

  // === UNMET WANTS (System 3) ===
  // How old a want must be (in hours) before it counts as "unfulfilled"
  unmetWantThresholdHours: 8, // 8 hours — wants persist until fulfilled now, so penalty only kicks in after a substantial unfulfilled period

  // === DAILY CAPS ===
  // Max total affinity loss across ALL systems per character per day
  dailyCap: -8,

  // Per-system caps (before global cap is applied)
  systemCaps: {
    naturalDecay: -5,
    jealousy: -4,
    unmetWants: -2,
    raquelCollateral: -3
  },

  // === NARRATIVE MEMORY GENERATION ===
  // Probability of creating an in-character memory per loss event
  narrativeChance: {
    small: 0.15,   // loss of -1 to -2: 15% chance
    medium: 0.40,  // loss of -3 to -4: 40% chance
    large: 0.70    // loss of -5+: 70% chance
  },

  // Probability of triggering adjust-subconscious for deep reflection
  subconsciousChance: {
    medium: 0.10,  // loss of -3 to -4: 10% chance
    large: 0.30    // loss of -5+: 30% chance
  },

  // Human names for filtering
  humans: HUMANS,

  // Characters excluded from ALL systems
  excludedCharacters: EXCLUDED_CHARACTERS
};

module.exports = { DECAY_CONFIG, HUMANS, EXCLUDED_CHARACTERS };
