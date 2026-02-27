// Tarot Deck — Full 78-card deck for the Daily Fate system
// Each card has upright/reversed keywords and themes that guide AI interpretation
// Used by: character-daily-reset.js (daily draw), admin-data.js (override/redraw)

const TAROT_DECK = [
  // ═══════════════════════════════════════════════════
  // MAJOR ARCANA (22 cards)
  // ═══════════════════════════════════════════════════
  {
    name: "The Fool",
    arcana: "major", number: 0, suit: null,
    upright: {
      keywords: ["new beginnings", "spontaneity", "innocence", "leap of faith", "freedom"],
      theme: "Starting fresh, acting on impulse, trusting the unknown"
    },
    reversed: {
      keywords: ["recklessness", "fear of change", "holding back", "naivety", "poor judgment"],
      theme: "Hesitation at the edge, foolish risks, refusing to move forward"
    }
  },
  {
    name: "The Magician",
    arcana: "major", number: 1, suit: null,
    upright: {
      keywords: ["willpower", "resourcefulness", "skill", "manifestation", "focus"],
      theme: "Everything you need is already in your hands — use it"
    },
    reversed: {
      keywords: ["manipulation", "wasted talent", "trickery", "unfocused", "self-doubt"],
      theme: "Power misdirected, skills going to waste, smoke and mirrors"
    }
  },
  {
    name: "The High Priestess",
    arcana: "major", number: 2, suit: null,
    upright: {
      keywords: ["intuition", "mystery", "inner knowledge", "stillness", "the unconscious"],
      theme: "Trust what you feel but cannot prove — the answers are beneath the surface"
    },
    reversed: {
      keywords: ["secrets", "disconnection", "ignored intuition", "withdrawal", "repression"],
      theme: "Something hidden demands attention, inner voice being silenced"
    }
  },
  {
    name: "The Empress",
    arcana: "major", number: 3, suit: null,
    upright: {
      keywords: ["abundance", "nurturing", "fertility", "beauty", "creation"],
      theme: "Generosity flows naturally, the urge to create and care for others"
    },
    reversed: {
      keywords: ["creative block", "dependence", "smothering", "neglect", "emptiness"],
      theme: "Giving too much or too little, creative wells running dry"
    }
  },
  {
    name: "The Emperor",
    arcana: "major", number: 4, suit: null,
    upright: {
      keywords: ["authority", "structure", "stability", "control", "leadership"],
      theme: "The need to impose order, to lead, to build something that lasts"
    },
    reversed: {
      keywords: ["tyranny", "rigidity", "domination", "loss of control", "inflexibility"],
      theme: "Control slipping or gripping too tight, authority without wisdom"
    }
  },
  {
    name: "The Hierophant",
    arcana: "major", number: 5, suit: null,
    upright: {
      keywords: ["tradition", "conformity", "guidance", "spiritual wisdom", "institutions"],
      theme: "Following established paths, seeking or offering wisdom, belonging"
    },
    reversed: {
      keywords: ["rebellion", "nonconformity", "questioning authority", "freedom from dogma", "unorthodox"],
      theme: "Breaking rules that no longer serve, challenging what everyone accepts"
    }
  },
  {
    name: "The Lovers",
    arcana: "major", number: 6, suit: null,
    upright: {
      keywords: ["love", "union", "partnership", "choices", "alignment"],
      theme: "A meaningful connection or a choice between two paths — both matter"
    },
    reversed: {
      keywords: ["disharmony", "imbalance", "misalignment", "broken trust", "inner conflict"],
      theme: "Values clashing, partnership under strain, choosing wrong for right reasons"
    }
  },
  {
    name: "The Chariot",
    arcana: "major", number: 7, suit: null,
    upright: {
      keywords: ["determination", "willpower", "victory", "ambition", "momentum"],
      theme: "Moving forward through sheer will — obstacles exist to be overcome"
    },
    reversed: {
      keywords: ["lack of direction", "aggression", "no control", "scattered energy", "defeat"],
      theme: "Wheels spinning without traction, force without purpose"
    }
  },
  {
    name: "Strength",
    arcana: "major", number: 8, suit: null,
    upright: {
      keywords: ["courage", "patience", "inner strength", "compassion", "gentle power"],
      theme: "True strength is quiet — patience, compassion, and endurance over force"
    },
    reversed: {
      keywords: ["self-doubt", "weakness", "raw emotion", "insecurity", "loss of nerve"],
      theme: "Confidence shaken, the beast inside harder to soothe today"
    }
  },
  {
    name: "The Hermit",
    arcana: "major", number: 9, suit: null,
    upright: {
      keywords: ["solitude", "introspection", "guidance", "inner light", "wisdom"],
      theme: "The need to withdraw, reflect, and find answers alone in the quiet"
    },
    reversed: {
      keywords: ["isolation", "loneliness", "withdrawal", "paranoia", "anti-social"],
      theme: "Solitude becoming prison, cutting off when connection is needed"
    }
  },
  {
    name: "Wheel of Fortune",
    arcana: "major", number: 10, suit: null,
    upright: {
      keywords: ["fate", "cycles", "turning point", "destiny", "luck"],
      theme: "The wheel turns — change is coming whether you're ready or not"
    },
    reversed: {
      keywords: ["bad luck", "resistance to change", "breaking cycles", "stagnation", "setbacks"],
      theme: "Fighting against the current, stuck in a loop that needs breaking"
    }
  },
  {
    name: "Justice",
    arcana: "major", number: 11, suit: null,
    upright: {
      keywords: ["fairness", "truth", "accountability", "balance", "cause and effect"],
      theme: "What's owed will be paid — truth demands acknowledgment today"
    },
    reversed: {
      keywords: ["injustice", "dishonesty", "unfairness", "avoidance", "bias"],
      theme: "Something unfair festers, accountability dodged, scales tipped wrong"
    }
  },
  {
    name: "The Hanged Man",
    arcana: "major", number: 12, suit: null,
    upright: {
      keywords: ["surrender", "new perspective", "letting go", "sacrifice", "suspension"],
      theme: "Everything looks different upside down — stop struggling and see clearly"
    },
    reversed: {
      keywords: ["stalling", "martyrdom", "resistance", "needless sacrifice", "indecision"],
      theme: "Stuck by choice, suffering without purpose, refusing to let go"
    }
  },
  {
    name: "Death",
    arcana: "major", number: 13, suit: null,
    upright: {
      keywords: ["endings", "transformation", "transition", "release", "inevitable change"],
      theme: "Something must end for something new to begin — resist and it hurts more"
    },
    reversed: {
      keywords: ["resistance to change", "stagnation", "decay", "fear of endings", "lingering"],
      theme: "Clinging to what's already gone, the refusal to let dead things rest"
    }
  },
  {
    name: "Temperance",
    arcana: "major", number: 14, suit: null,
    upright: {
      keywords: ["balance", "moderation", "patience", "harmony", "purpose"],
      theme: "Finding the middle path, blending opposites, patience as practice"
    },
    reversed: {
      keywords: ["imbalance", "excess", "impatience", "lack of purpose", "discord"],
      theme: "Too much of something, not enough of another — equilibrium lost"
    }
  },
  {
    name: "The Devil",
    arcana: "major", number: 15, suit: null,
    upright: {
      keywords: ["shadow self", "attachment", "addiction", "temptation", "bondage"],
      theme: "The chains are loose enough to remove — if you want to"
    },
    reversed: {
      keywords: ["release", "breaking free", "reclaiming power", "detachment", "revelation"],
      theme: "Seeing the trap for what it is, choosing freedom over comfort"
    }
  },
  {
    name: "The Tower",
    arcana: "major", number: 16, suit: null,
    upright: {
      keywords: ["upheaval", "sudden change", "revelation", "chaos", "destruction"],
      theme: "The lightning strike — something built on false foundations must fall"
    },
    reversed: {
      keywords: ["avoided disaster", "fear of change", "delayed reckoning", "personal transformation"],
      theme: "The tower shakes but holds — transformation happening internally instead"
    }
  },
  {
    name: "The Star",
    arcana: "major", number: 17, suit: null,
    upright: {
      keywords: ["hope", "renewal", "serenity", "inspiration", "faith"],
      theme: "After the storm, clarity — hope is not naive, it's necessary"
    },
    reversed: {
      keywords: ["despair", "disconnection", "lack of faith", "hopelessness", "disillusionment"],
      theme: "The light feels far away, faith tested, inspiration dried up"
    }
  },
  {
    name: "The Moon",
    arcana: "major", number: 18, suit: null,
    upright: {
      keywords: ["illusion", "fear", "anxiety", "subconscious", "intuition"],
      theme: "Nothing is as it seems — trust your gut even when your eyes lie"
    },
    reversed: {
      keywords: ["clarity", "releasing fear", "truth emerging", "confusion lifting", "facing shadows"],
      theme: "The fog lifts, fears confronted, what was hidden becomes visible"
    }
  },
  {
    name: "The Sun",
    arcana: "major", number: 19, suit: null,
    upright: {
      keywords: ["joy", "success", "vitality", "warmth", "positivity"],
      theme: "Everything is illuminated — genuine warmth, simple happiness, nothing hidden"
    },
    reversed: {
      keywords: ["inner child wounded", "dimmed joy", "temporary setback", "overexposure", "burnout"],
      theme: "The light is there but harder to feel, joy requiring effort today"
    }
  },
  {
    name: "Judgement",
    arcana: "major", number: 20, suit: null,
    upright: {
      keywords: ["reflection", "reckoning", "awakening", "renewal", "calling"],
      theme: "A moment of truth — who you've been versus who you're becoming"
    },
    reversed: {
      keywords: ["self-doubt", "avoiding reckoning", "harsh self-judgment", "stagnation", "denial"],
      theme: "Refusing to look in the mirror, judging yourself or others too harshly"
    }
  },
  {
    name: "The World",
    arcana: "major", number: 21, suit: null,
    upright: {
      keywords: ["completion", "integration", "accomplishment", "wholeness", "travel"],
      theme: "A cycle completing — everything comes together, belonging in the world"
    },
    reversed: {
      keywords: ["incompletion", "stagnation", "lack of closure", "shortcuts", "emptiness"],
      theme: "Almost there but not quite, the finish line moving, loose ends dangling"
    }
  },

  // ═══════════════════════════════════════════════════
  // CUPS — Emotions, relationships, intuition, creativity
  // ═══════════════════════════════════════════════════
  {
    name: "Ace of Cups", arcana: "minor", number: 1, suit: "cups",
    upright: { keywords: ["new love", "emotional awakening", "compassion", "intuition", "overflowing feeling"], theme: "The heart opens — a new emotional beginning" },
    reversed: { keywords: ["emotional loss", "blocked feelings", "emptiness", "repression", "missed connection"], theme: "Feelings bottled up, the cup turned over before it could fill" }
  },
  {
    name: "Two of Cups", arcana: "minor", number: 2, suit: "cups",
    upright: { keywords: ["partnership", "mutual attraction", "unity", "connection", "reciprocity"], theme: "Two souls recognizing each other — give and take in balance" },
    reversed: { keywords: ["imbalance", "broken partnership", "miscommunication", "tension", "separation"], theme: "A bond strained, one giving more than the other" }
  },
  {
    name: "Three of Cups", arcana: "minor", number: 3, suit: "cups",
    upright: { keywords: ["celebration", "friendship", "community", "joy", "togetherness"], theme: "The warmth of people who choose to be together" },
    reversed: { keywords: ["overindulgence", "gossip", "exclusion", "isolation", "third wheel"], theme: "The party that leaves someone out, or goes on too long" }
  },
  {
    name: "Four of Cups", arcana: "minor", number: 4, suit: "cups",
    upright: { keywords: ["apathy", "contemplation", "dissatisfaction", "missed opportunity", "withdrawal"], theme: "Something offered, something ignored — boredom masking something deeper" },
    reversed: { keywords: ["new awareness", "acceptance", "motivation returning", "seizing opportunity", "gratitude"], theme: "Eyes finally opening to what was always there" }
  },
  {
    name: "Five of Cups", arcana: "minor", number: 5, suit: "cups",
    upright: { keywords: ["grief", "regret", "loss", "disappointment", "dwelling on the past"], theme: "Three cups spilled, two still standing — but the eyes only see what's lost" },
    reversed: { keywords: ["acceptance", "moving on", "finding peace", "forgiveness", "recovery"], theme: "Turning around to see what remains, choosing forward over backward" }
  },
  {
    name: "Six of Cups", arcana: "minor", number: 6, suit: "cups",
    upright: { keywords: ["nostalgia", "childhood memories", "innocence", "reunion", "sentimentality"], theme: "The past calls sweetly — old memories coloring the present" },
    reversed: { keywords: ["stuck in past", "unrealistic nostalgia", "moving forward", "leaving behind", "maturity"], theme: "The past wasn't as golden as memory insists" }
  },
  {
    name: "Seven of Cups", arcana: "minor", number: 7, suit: "cups",
    upright: { keywords: ["fantasy", "illusion", "wishful thinking", "choices", "daydreaming"], theme: "So many possibilities that none feel real — dreaming without choosing" },
    reversed: { keywords: ["clarity", "reality check", "making choices", "focus", "alignment"], theme: "The fog of fantasy clears, reality becomes preferable to dreams" }
  },
  {
    name: "Eight of Cups", arcana: "minor", number: 8, suit: "cups",
    upright: { keywords: ["walking away", "disillusionment", "leaving behind", "seeking more", "courage to go"], theme: "Turning your back on what no longer serves — it hurts, but it's right" },
    reversed: { keywords: ["fear of change", "staying too long", "avoidance", "aimless wandering", "clinging"], theme: "Knowing you should leave but staying anyway" }
  },
  {
    name: "Nine of Cups", arcana: "minor", number: 9, suit: "cups",
    upright: { keywords: ["contentment", "satisfaction", "wish fulfilled", "emotional fulfillment", "luxury"], theme: "The wish granted — genuine satisfaction, enjoying what you have" },
    reversed: { keywords: ["dissatisfaction", "materialism", "greed", "unfulfilled wishes", "smugness"], theme: "Having everything and feeling nothing, or wanting more than your share" }
  },
  {
    name: "Ten of Cups", arcana: "minor", number: 10, suit: "cups",
    upright: { keywords: ["harmony", "family", "emotional fulfillment", "happiness", "alignment"], theme: "The rainbow after rain — belonging, love, and peace all at once" },
    reversed: { keywords: ["broken family", "domestic trouble", "disconnection", "unrealistic expectations", "dysfunction"], theme: "The picture-perfect image cracking, home not feeling like home" }
  },
  {
    name: "Page of Cups", arcana: "minor", number: 11, suit: "cups",
    upright: { keywords: ["creative opportunity", "curiosity", "intuitive message", "youthful emotion", "wonder"], theme: "A small emotional surprise — something tender and unexpected arrives" },
    reversed: { keywords: ["emotional immaturity", "creative block", "insecurity", "escapism", "oversensitivity"], theme: "Feelings too big for their container, creativity sputtering" }
  },
  {
    name: "Knight of Cups", arcana: "minor", number: 12, suit: "cups",
    upright: { keywords: ["romance", "charm", "creativity", "imagination", "following the heart"], theme: "The heart leads and the feet follow — romantic, idealistic energy" },
    reversed: { keywords: ["unrealistic", "jealousy", "moodiness", "disappointment", "false promises"], theme: "Charm without substance, promises the heart can't keep" }
  },
  {
    name: "Queen of Cups", arcana: "minor", number: 13, suit: "cups",
    upright: { keywords: ["compassion", "emotional security", "intuition", "nurturing", "calm"], theme: "Deep emotional wisdom — feeling everything and still staying whole" },
    reversed: { keywords: ["co-dependence", "emotional manipulation", "insecurity", "martyrdom", "overwhelm"], theme: "Drowning in other people's feelings, losing yourself in care" }
  },
  {
    name: "King of Cups", arcana: "minor", number: 14, suit: "cups",
    upright: { keywords: ["emotional maturity", "diplomacy", "compassion", "balance", "calm authority"], theme: "Mastery of feeling — deep waters, still surface" },
    reversed: { keywords: ["emotional volatility", "manipulation", "coldness", "suppression", "moody"], theme: "The mask of composure cracking, feelings weaponized or frozen" }
  },

  // ═══════════════════════════════════════════════════
  // WANDS — Passion, creativity, ambition, energy, will
  // ═══════════════════════════════════════════════════
  {
    name: "Ace of Wands", arcana: "minor", number: 1, suit: "wands",
    upright: { keywords: ["inspiration", "new venture", "creative spark", "enthusiasm", "potential"], theme: "A fire lit — the beginning of something bold and alive" },
    reversed: { keywords: ["delays", "lack of motivation", "creative block", "hesitation", "wasted potential"], theme: "The spark fizzles, energy present but direction missing" }
  },
  {
    name: "Two of Wands", arcana: "minor", number: 2, suit: "wands",
    upright: { keywords: ["planning", "future vision", "decisions", "discovery", "restlessness"], theme: "Standing at the threshold, world in hand, deciding which way to go" },
    reversed: { keywords: ["fear of unknown", "lack of planning", "playing it safe", "indecision", "limited vision"], theme: "Staying in the tower instead of exploring what's beyond it" }
  },
  {
    name: "Three of Wands", arcana: "minor", number: 3, suit: "wands",
    upright: { keywords: ["expansion", "foresight", "progress", "opportunity", "looking ahead"], theme: "Ships on the horizon — plans becoming reality, patience rewarded" },
    reversed: { keywords: ["obstacles", "delays", "frustration", "setbacks", "short-sightedness"], theme: "Plans stalling, the horizon cloudier than expected" }
  },
  {
    name: "Four of Wands", arcana: "minor", number: 4, suit: "wands",
    upright: { keywords: ["celebration", "homecoming", "stability", "community", "achievement"], theme: "The foundations are laid — time to celebrate what's been built" },
    reversed: { keywords: ["instability", "lack of support", "transience", "conflict at home", "cancelled plans"], theme: "The celebration postponed, the foundation shakier than it looks" }
  },
  {
    name: "Five of Wands", arcana: "minor", number: 5, suit: "wands",
    upright: { keywords: ["conflict", "competition", "disagreement", "tension", "diversity of opinion"], theme: "Everyone talking, nobody listening — productive friction or just noise" },
    reversed: { keywords: ["avoidance of conflict", "resolution", "compromise", "inner conflict", "intimidation"], theme: "The fight avoided or finally resolved — peace through exhaustion or wisdom" }
  },
  {
    name: "Six of Wands", arcana: "minor", number: 6, suit: "wands",
    upright: { keywords: ["victory", "recognition", "success", "public acclaim", "confidence"], theme: "The crowd parts — you did the thing and people noticed" },
    reversed: { keywords: ["ego", "fall from grace", "lack of recognition", "arrogance", "private victory"], theme: "Success that nobody sees, or acclaim that inflates the wrong part of you" }
  },
  {
    name: "Seven of Wands", arcana: "minor", number: 7, suit: "wands",
    upright: { keywords: ["defensiveness", "perseverance", "standing your ground", "challenge", "resilience"], theme: "The hill you chose to die on — defending what matters against pressure" },
    reversed: { keywords: ["giving up", "overwhelm", "exhaustion", "backing down", "admitting defeat"], theme: "Too many fronts, too little energy — the walls can't hold forever" }
  },
  {
    name: "Eight of Wands", arcana: "minor", number: 8, suit: "wands",
    upright: { keywords: ["swift action", "momentum", "rapid progress", "movement", "things in motion"], theme: "Everything accelerating — events moving faster than thoughts can follow" },
    reversed: { keywords: ["delays", "frustration", "waiting", "scattered energy", "miscommunication"], theme: "Messages lost, plans delayed, the arrow stuck mid-flight" }
  },
  {
    name: "Nine of Wands", arcana: "minor", number: 9, suit: "wands",
    upright: { keywords: ["resilience", "persistence", "last stand", "boundaries", "near completion"], theme: "Battered but standing — one more push and the wall holds" },
    reversed: { keywords: ["paranoia", "defensiveness", "stubbornness", "burnout", "giving in"], theme: "Guarding against threats that may not exist, exhaustion winning" }
  },
  {
    name: "Ten of Wands", arcana: "minor", number: 10, suit: "wands",
    upright: { keywords: ["burden", "responsibility", "hard work", "stress", "duty"], theme: "Carrying more than your share and refusing to put any of it down" },
    reversed: { keywords: ["release", "delegation", "breakdown", "letting go of burden", "overextension"], theme: "Something has to give — the load lightens or the carrier breaks" }
  },
  {
    name: "Page of Wands", arcana: "minor", number: 11, suit: "wands",
    upright: { keywords: ["exploration", "enthusiasm", "discovery", "free spirit", "new ideas"], theme: "Bright-eyed energy — everything is interesting, everything is possible" },
    reversed: { keywords: ["lack of direction", "procrastination", "distraction", "hasty decisions", "boredom"], theme: "Enthusiasm without follow-through, the spark that never catches" }
  },
  {
    name: "Knight of Wands", arcana: "minor", number: 12, suit: "wands",
    upright: { keywords: ["adventure", "passion", "impulsiveness", "daring", "energy"], theme: "Charging forward with fire — bold, reckless, absolutely alive" },
    reversed: { keywords: ["recklessness", "haste", "scattered", "delays", "frustration"], theme: "Speed without direction, passion burning holes in plans" }
  },
  {
    name: "Queen of Wands", arcana: "minor", number: 13, suit: "wands",
    upright: { keywords: ["confidence", "independence", "warmth", "determination", "social butterfly"], theme: "Walking into any room and owning it — warmth as weapon and gift" },
    reversed: { keywords: ["selfishness", "jealousy", "insecurity", "demanding", "temperamental"], theme: "Confidence curdled into need, warmth weaponized" }
  },
  {
    name: "King of Wands", arcana: "minor", number: 14, suit: "wands",
    upright: { keywords: ["leadership", "vision", "big picture", "boldness", "entrepreneurial"], theme: "The one who sees the whole board and moves first" },
    reversed: { keywords: ["impulsiveness", "tyranny", "overbearing", "unrealistic expectations", "ruthless"], theme: "Vision without patience, leadership without listening" }
  },

  // ═══════════════════════════════════════════════════
  // SWORDS — Intellect, conflict, truth, communication, power
  // ═══════════════════════════════════════════════════
  {
    name: "Ace of Swords", arcana: "minor", number: 1, suit: "swords",
    upright: { keywords: ["clarity", "breakthrough", "truth", "new idea", "sharp focus"], theme: "The cut that clears the fog — sudden clarity, undeniable truth" },
    reversed: { keywords: ["confusion", "miscommunication", "brutality", "clouded judgment", "harsh words"], theme: "The blade cuts the wrong thing, truth twisted into cruelty" }
  },
  {
    name: "Two of Swords", arcana: "minor", number: 2, suit: "swords",
    upright: { keywords: ["indecision", "stalemate", "difficult choice", "avoidance", "blocked emotions"], theme: "Two options, eyes closed — the choice you're refusing to make" },
    reversed: { keywords: ["information overload", "lesser of evils", "confusion", "truth revealed", "overwhelm"], theme: "The blindfold slips and both options are worse than imagined" }
  },
  {
    name: "Three of Swords", arcana: "minor", number: 3, suit: "swords",
    upright: { keywords: ["heartbreak", "grief", "sorrow", "painful truth", "separation"], theme: "The truth that hurts — better to feel it than pretend it's not there" },
    reversed: { keywords: ["healing", "forgiveness", "releasing pain", "recovery", "optimism returning"], theme: "The wound closing, slowly, imperfectly, but closing" }
  },
  {
    name: "Four of Swords", arcana: "minor", number: 4, suit: "swords",
    upright: { keywords: ["rest", "recuperation", "contemplation", "retreat", "stillness"], theme: "The warrior rests — not defeated, recovering. Stillness is strategy." },
    reversed: { keywords: ["restlessness", "burnout", "need for rest", "stagnation", "anxiety"], theme: "Refusing to rest, the mind racing even in supposed quiet" }
  },
  {
    name: "Five of Swords", arcana: "minor", number: 5, suit: "swords",
    upright: { keywords: ["conflict", "defeat", "winning at a cost", "hostility", "betrayal"], theme: "You won, but look at what it cost — hollow victory, bitter taste" },
    reversed: { keywords: ["reconciliation", "making amends", "past resentment", "moving on", "compromise"], theme: "Putting down the sword, choosing peace over being right" }
  },
  {
    name: "Six of Swords", arcana: "minor", number: 6, suit: "swords",
    upright: { keywords: ["transition", "moving on", "leaving behind", "gradual recovery", "journey"], theme: "The slow boat to somewhere better — leaving pain on the shore behind" },
    reversed: { keywords: ["stuck", "unresolved baggage", "resistance to change", "emotional baggage", "return to trouble"], theme: "The boat circling back, unable to leave the familiar pain behind" }
  },
  {
    name: "Seven of Swords", arcana: "minor", number: 7, suit: "swords",
    upright: { keywords: ["deception", "strategy", "stealth", "cunning", "getting away with it"], theme: "Moving in shadows — clever or dishonest, depending on the light" },
    reversed: { keywords: ["exposure", "confession", "conscience", "coming clean", "getting caught"], theme: "The secret slipping, the truth wanting out more than you want it in" }
  },
  {
    name: "Eight of Swords", arcana: "minor", number: 8, suit: "swords",
    upright: { keywords: ["trapped", "restricted", "victim mentality", "self-imposed prison", "helplessness"], theme: "Surrounded by swords that aren't actually touching you — the cage is belief" },
    reversed: { keywords: ["self-acceptance", "new perspective", "freedom", "release", "empowerment"], theme: "Realizing the bindings were loose all along, stepping out" }
  },
  {
    name: "Nine of Swords", arcana: "minor", number: 9, suit: "swords",
    upright: { keywords: ["anxiety", "nightmares", "worry", "despair", "mental anguish"], theme: "3 AM thoughts — the worst-case scenarios playing on repeat" },
    reversed: { keywords: ["hope", "reaching out", "overcoming fear", "recovery", "light at end of tunnel"], theme: "The worst of the worry passing, morning coming despite the night" }
  },
  {
    name: "Ten of Swords", arcana: "minor", number: 10, suit: "swords",
    upright: { keywords: ["rock bottom", "painful ending", "betrayal", "crisis", "total defeat"], theme: "The worst has happened — and now the only direction is up" },
    reversed: { keywords: ["recovery", "regeneration", "resisting ending", "can't get worse", "survival"], theme: "Pulling the swords out one by one, refusing to stay down" }
  },
  {
    name: "Page of Swords", arcana: "minor", number: 11, suit: "swords",
    upright: { keywords: ["curiosity", "restlessness", "mental energy", "new ideas", "vigilance"], theme: "Mind sharp and hungry — asking questions nobody else thinks to ask" },
    reversed: { keywords: ["gossip", "cynicism", "haste", "all talk", "scattered thoughts"], theme: "Sharp tongue, scattered mind, cleverness without kindness" }
  },
  {
    name: "Knight of Swords", arcana: "minor", number: 12, suit: "swords",
    upright: { keywords: ["ambition", "action", "drive", "assertiveness", "fast thinking"], theme: "Charging at the truth with sword drawn — brave or foolish or both" },
    reversed: { keywords: ["impulsive", "burnout", "scattered", "no follow-through", "aggressive"], theme: "Swinging at everything and connecting with nothing" }
  },
  {
    name: "Queen of Swords", arcana: "minor", number: 13, suit: "swords",
    upright: { keywords: ["clear thinking", "independence", "boundaries", "direct communication", "perceptive"], theme: "The one who sees through the noise and says what needs saying" },
    reversed: { keywords: ["cold", "bitter", "overly critical", "cruel honesty", "isolation"], theme: "Clarity become cruelty, boundaries become walls" }
  },
  {
    name: "King of Swords", arcana: "minor", number: 14, suit: "swords",
    upright: { keywords: ["intellectual power", "authority", "truth", "analytical", "ethical"], theme: "The mind ruling the heart — clear judgment, fair decisions, sharp authority" },
    reversed: { keywords: ["manipulation", "cruelty", "abuse of power", "tyranny", "cold logic"], theme: "Intelligence without empathy, authority without compassion" }
  },

  // ═══════════════════════════════════════════════════
  // PENTACLES — Material world, work, finances, health, stability
  // ═══════════════════════════════════════════════════
  {
    name: "Ace of Pentacles", arcana: "minor", number: 1, suit: "pentacles",
    upright: { keywords: ["opportunity", "new venture", "prosperity", "manifestation", "abundance"], theme: "Something tangible offered — a chance to build something real" },
    reversed: { keywords: ["missed opportunity", "scarcity", "poor planning", "instability", "greed"], theme: "The golden coin slipping through fingers, opportunity squandered" }
  },
  {
    name: "Two of Pentacles", arcana: "minor", number: 2, suit: "pentacles",
    upright: { keywords: ["balance", "juggling", "adaptability", "flexibility", "time management"], theme: "Keeping all the plates spinning — chaos that somehow works" },
    reversed: { keywords: ["overwhelm", "disorganization", "imbalance", "overcommitted", "dropping the ball"], theme: "Too many plates, not enough hands — something's going to fall" }
  },
  {
    name: "Three of Pentacles", arcana: "minor", number: 3, suit: "pentacles",
    upright: { keywords: ["teamwork", "collaboration", "skill", "learning", "craftsmanship"], theme: "Building something together — each person's skill making the whole better" },
    reversed: { keywords: ["disharmony", "lack of teamwork", "poor quality", "conflict in group", "misalignment"], theme: "The group working against itself, egos over excellence" }
  },
  {
    name: "Four of Pentacles", arcana: "minor", number: 4, suit: "pentacles",
    upright: { keywords: ["security", "control", "possessiveness", "conservation", "stability"], theme: "Holding tight to what you have — safe, but at what cost?" },
    reversed: { keywords: ["generosity", "letting go", "financial insecurity", "reckless spending", "releasing control"], theme: "Opening the hands, whether by choice or by force" }
  },
  {
    name: "Five of Pentacles", arcana: "minor", number: 5, suit: "pentacles",
    upright: { keywords: ["hardship", "loss", "isolation", "worry", "insecurity"], theme: "Walking past the warm window in the cold — help is closer than it seems" },
    reversed: { keywords: ["recovery", "improvement", "turning a corner", "spiritual wealth", "acceptance"], theme: "The worst of the winter passing, warmth found in unexpected places" }
  },
  {
    name: "Six of Pentacles", arcana: "minor", number: 6, suit: "pentacles",
    upright: { keywords: ["generosity", "charity", "giving", "sharing", "fairness"], theme: "The balance of giving and receiving — who holds the scale matters" },
    reversed: { keywords: ["strings attached", "inequality", "debt", "selfishness", "power imbalance"], theme: "Generosity with conditions, gifts that become chains" }
  },
  {
    name: "Seven of Pentacles", arcana: "minor", number: 7, suit: "pentacles",
    upright: { keywords: ["patience", "assessment", "long-term investment", "perseverance", "reward"], theme: "Staring at the garden, wondering if the seeds were worth planting" },
    reversed: { keywords: ["impatience", "wasted effort", "lack of growth", "frustration", "bad investment"], theme: "The harvest isn't coming, the investment wasn't worth it" }
  },
  {
    name: "Eight of Pentacles", arcana: "minor", number: 8, suit: "pentacles",
    upright: { keywords: ["diligence", "mastery", "skill development", "hard work", "detail"], theme: "Head down, hands busy — getting better through repetition and care" },
    reversed: { keywords: ["perfectionism", "lack of motivation", "shortcuts", "mediocrity", "boredom"], theme: "The craft losing its joy, excellence sliding into obsession or apathy" }
  },
  {
    name: "Nine of Pentacles", arcana: "minor", number: 9, suit: "pentacles",
    upright: { keywords: ["luxury", "self-sufficiency", "financial independence", "discipline", "reward"], theme: "The garden you built with your own hands — enjoying what you've earned" },
    reversed: { keywords: ["overwork", "financial setback", "superficiality", "loss of independence", "reckless spending"], theme: "The beautiful life hiding an empty foundation" }
  },
  {
    name: "Ten of Pentacles", arcana: "minor", number: 10, suit: "pentacles",
    upright: { keywords: ["legacy", "inheritance", "family", "wealth", "long-term success"], theme: "What you build outlasts you — roots deep enough to weather anything" },
    reversed: { keywords: ["family disputes", "financial failure", "loss of legacy", "instability", "short-term thinking"], theme: "The family fortune crumbling, legacy questioned, foundations cracking" }
  },
  {
    name: "Page of Pentacles", arcana: "minor", number: 11, suit: "pentacles",
    upright: { keywords: ["ambition", "desire to learn", "opportunity", "new skill", "diligence"], theme: "The student ready for the lesson — eager, practical, willing to work" },
    reversed: { keywords: ["lack of progress", "procrastination", "missed chance", "unfocused", "laziness"], theme: "The lesson available but the student distracted" }
  },
  {
    name: "Knight of Pentacles", arcana: "minor", number: 12, suit: "pentacles",
    upright: { keywords: ["hard work", "routine", "reliability", "patience", "methodical"], theme: "The slow horse that always arrives — dependable, steady, unglamorous progress" },
    reversed: { keywords: ["stagnation", "laziness", "boredom", "feeling stuck", "perfectionism blocking action"], theme: "Steady turned to stuck, reliability calcified into routine" }
  },
  {
    name: "Queen of Pentacles", arcana: "minor", number: 13, suit: "pentacles",
    upright: { keywords: ["nurturing", "practical", "providing", "homebody", "financial security"], theme: "Making the world comfortable and safe — practical love in action" },
    reversed: { keywords: ["work-life imbalance", "neglect", "smothering", "financial dependence", "materialism"], theme: "Caring for everything except yourself, or measuring love in things" }
  },
  {
    name: "King of Pentacles", arcana: "minor", number: 14, suit: "pentacles",
    upright: { keywords: ["wealth", "business", "security", "discipline", "abundance"], theme: "The one who built the kingdom with patience and kept it with wisdom" },
    reversed: { keywords: ["greed", "indulgence", "poor financial decisions", "stubbornness", "materialism"], theme: "Wealth becoming identity, security becoming hoarding" }
  }
];

// ═══════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════

/**
 * Draw a random card with random orientation (upright/reversed)
 * @returns {{ card: Object, orientation: string }}
 */
function drawCard() {
  const card = TAROT_DECK[Math.floor(Math.random() * TAROT_DECK.length)];
  const orientation = Math.random() < 0.5 ? 'upright' : 'reversed';
  return { card, orientation };
}

/**
 * Look up a card by exact name
 * @param {string} name - e.g. "The Tower", "Three of Cups"
 * @returns {Object|null}
 */
function getCardByName(name) {
  return TAROT_DECK.find(c => c.name === name) || null;
}

/**
 * Formatted display string
 * @param {string} name - Card name
 * @param {string} orientation - "upright" or "reversed"
 * @returns {string}
 */
function getCardDisplay(name, orientation) {
  return `${name} (${orientation})`;
}

module.exports = { TAROT_DECK, drawCard, getCardByName, getCardDisplay };
