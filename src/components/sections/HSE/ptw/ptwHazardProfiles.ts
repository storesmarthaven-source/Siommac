/**
 * src/components/sections/HSE/ptw/ptwHazardProfiles.ts
 *
 * Permit-type-driven hazard profile catalog.
 * Keyed by the permit_type snake_case value (from hse_permit_type_config).
 * Each profile provides required + recommended hazards with suggested controls.
 *
 * The wizard uses this to pre-populate Step 4 (Hazards & Controls).
 */

export type HazardCategory =
  | 'Fire & Explosion'
  | 'Atmosphere'
  | 'Chemical'
  | 'Electrical'
  | 'Mechanical'
  | 'Physical'
  | 'Ergonomic'
  | 'Structural'
  | 'Environmental'
  | 'Biological'
  | 'Radiation'
  | 'Gravity'
  | 'Pressure'
  | 'Thermal'
  | 'Other';

export interface CatalogHazard {
  /** Stable ID for diffing / selection state (local, not DB) */
  id: string;
  name: string;
  category: HazardCategory;
  suggestedControls: string[];
}

export interface HazardProfile {
  required:    CatalogHazard[];
  recommended: CatalogHazard[];
}

// ── Hot Work ──────────────────────────────────────────────────────────────────

const HOT_WORK: HazardProfile = {
  required: [
    {
      id: 'hw_fire_explosion',
      name: 'Fire / explosion',
      category: 'Fire & Explosion',
      suggestedControls: [
        'Remove combustibles within 11 m radius',
        'Fire watch assigned for duration + 30 min post-work',
        'Serviceable fire extinguisher at point-of-work',
        'Spark containment mat / screens',
        'Gas test — LEL < 1% before ignition',
        'Barricade / exclusion zone established',
      ],
    },
    {
      id: 'hw_flammable_vapors',
      name: 'Flammable vapors',
      category: 'Fire & Explosion',
      suggestedControls: [
        'Continuous gas monitoring during work',
        'Hot-work permit suspended if LEL ≥ 10%',
        'Ventilate area before and during work',
        'Identify and isolate all vapor sources',
      ],
    },
    {
      id: 'hw_sparks_slag',
      name: 'Sparks / hot slag',
      category: 'Fire & Explosion',
      suggestedControls: [
        'Welding blanket / fire-resistant covering on all drains',
        'Spark guards / welding screens',
        'PPE: face shield, leather gloves, flame-resistant overalls',
        'All combustible debris cleared from work area',
      ],
    },
    {
      id: 'hw_combustibles_nearby',
      name: 'Combustible materials nearby',
      category: 'Fire & Explosion',
      suggestedControls: [
        'Wet-down or remove all combustibles within 11 m',
        'Non-combustible covers where removal is impractical',
        'Inspect area post-work for smouldering',
      ],
    },
  ],
  recommended: [
    {
      id: 'hw_poor_ventilation',
      name: 'Poor ventilation',
      category: 'Atmosphere',
      suggestedControls: [
        'Local exhaust ventilation / forced-air supply',
        'Continuous oxygen and toxic-gas monitoring',
        'Reduce work duration / rotation intervals',
      ],
    },
    {
      id: 'hw_gas_cylinders',
      name: 'Gas cylinders',
      category: 'Pressure',
      suggestedControls: [
        'Cylinders chained / secured upright outside hot zone',
        'Flashback arrestors fitted on both ends of hoses',
        'Inspect hoses and connections before use',
        'Close valves and remove cylinders when not in use',
      ],
    },
    {
      id: 'hw_heat_stress',
      name: 'Heat stress',
      category: 'Thermal',
      suggestedControls: [
        'Work/rest schedule in line with heat index',
        'Drinking water available at work site',
        'Shade or cooling rest area within 50 m',
        'Buddy system — monitor for heat illness symptoms',
      ],
    },
    {
      id: 'hw_process_equipment',
      name: 'Work near process equipment',
      category: 'Physical',
      suggestedControls: [
        'Confirm equipment is de-energised and isolated (LOTO)',
        'Coordinate with operations to shut down / quench nearby lines',
        'Standby person to monitor process status',
      ],
    },
  ],
};

// ── Confined Space ────────────────────────────────────────────────────────────

const CONFINED_SPACE: HazardProfile = {
  required: [
    {
      id: 'cs_oxygen_deficiency',
      name: 'Oxygen deficiency',
      category: 'Atmosphere',
      suggestedControls: [
        'Pre-entry atmospheric test: O₂ 19.5–23.5%',
        'Continuous monitoring throughout entry',
        'Forced mechanical ventilation',
        'SCBA available for emergency rescue',
      ],
    },
    {
      id: 'cs_toxic_atmosphere',
      name: 'Toxic atmosphere',
      category: 'Atmosphere',
      suggestedControls: [
        'Multi-gas monitor calibrated before entry',
        'Test for H₂S, CO, LEL and O₂ before entry',
        'Continuous gas monitoring by entrant',
        'Supplied-air respirator if atmosphere is unknown',
      ],
    },
    {
      id: 'cs_restricted_access',
      name: 'Restricted access / egress',
      category: 'Physical',
      suggestedControls: [
        'Rescue plan documented and rescuers briefed',
        'Tripod and retrieval line rigged at entry point',
        'Entry point kept clear at all times',
        'Communication established between entrant and attendant',
      ],
    },
    {
      id: 'cs_engulfment',
      name: 'Engulfment',
      category: 'Physical',
      suggestedControls: [
        'Isolate all inlet pipes and lock valves',
        'Blank / blind off all flow paths',
        'Confirm empty / dry before entry',
        'Entrant wears full-body harness',
      ],
    },
    {
      id: 'cs_poor_communication',
      name: 'Poor communication',
      category: 'Other',
      suggestedControls: [
        'Intrinsically safe radio or hard-wire comm system',
        'Regular check-in schedule between entrant and attendant',
        'Emergency alarm tested before entry',
        'Attendant stationed at entry point for full duration',
      ],
    },
  ],
  recommended: [
    {
      id: 'cs_heat_stress',
      name: 'Heat stress in confined space',
      category: 'Thermal',
      suggestedControls: [
        'Ventilate to reduce temperature before and during entry',
        'Limit continuous work periods (30 min max in extreme heat)',
        'Cold water supply; electrolyte drinks available',
      ],
    },
    {
      id: 'cs_poor_lighting',
      name: 'Poor lighting',
      category: 'Physical',
      suggestedControls: [
        'Intrinsically safe portable lighting (EX-rated where applicable)',
        'Headlamp worn by entrant',
        'Entry point illuminated from outside',
      ],
    },
    {
      id: 'cs_mechanical_energy',
      name: 'Mechanical energy (agitators, rotating parts)',
      category: 'Mechanical',
      suggestedControls: [
        'De-energise and LOTO all rotating equipment',
        'Blocks / blanks fitted on agitator shafts',
        'LOTO verified by second person before entry',
      ],
    },
  ],
};

// ── Electrical Work ───────────────────────────────────────────────────────────

const ELECTRICAL_WORK: HazardProfile = {
  required: [
    {
      id: 'ew_live_parts',
      name: 'Live electrical parts',
      category: 'Electrical',
      suggestedControls: [
        'Confirm isolation and test for zero voltage (test-before-touch)',
        'LOTO applied at all relevant isolation points',
        'Insulated tools and PPE (gloves, mat, face shield)',
        'Barriers and warning signs around work zone',
      ],
    },
    {
      id: 'ew_arc_flash',
      name: 'Arc flash',
      category: 'Electrical',
      suggestedControls: [
        'Arc flash risk assessment completed',
        'Appropriate PPE category (ARC-rated suit, face shield)',
        'Only qualified/authorised persons to work on live circuits',
        'Minimum approach distance maintained',
      ],
    },
    {
      id: 'ew_stored_energy',
      name: 'Stored electrical energy (capacitors, UPS)',
      category: 'Electrical',
      suggestedControls: [
        'Allow adequate discharge time before touching',
        'Verify zero energy with calibrated meter',
        'Discharge capacitors to ground with rated discharge tool',
      ],
    },
    {
      id: 'ew_backfeed',
      name: 'Backfeed / unexpected energisation',
      category: 'Electrical',
      suggestedControls: [
        'All upstream and downstream isolation points locked out',
        'LOTO locks from all affected trades',
        'Notify operations and maintenance before and after work',
      ],
    },
  ],
  recommended: [
    {
      id: 'ew_damaged_cables',
      name: 'Damaged cables / insulation',
      category: 'Electrical',
      suggestedControls: [
        'Visual inspection of all cables before work',
        'Replace or repair any damaged insulation',
        'Route cables away from sharp edges and walkways',
      ],
    },
    {
      id: 'ew_temporary_power',
      name: 'Temporary power supplies',
      category: 'Electrical',
      suggestedControls: [
        'RCD / GFCI on all temporary supplies',
        'Regular inspection of leads and connections',
        'Remove temporary power when not in use',
      ],
    },
    {
      id: 'ew_water_near_electrical',
      name: 'Water near electrical equipment',
      category: 'Electrical',
      suggestedControls: [
        'Confirm IP rating of equipment is adequate',
        'Temporary barriers to prevent water ingress',
        'Electrical work stopped during rain / wet conditions',
      ],
    },
  ],
};

// ── Excavation ────────────────────────────────────────────────────────────────

const EXCAVATION: HazardProfile = {
  required: [
    {
      id: 'ex_underground_services',
      name: 'Underground services (pipes, cables)',
      category: 'Physical',
      suggestedControls: [
        'CAT & Genny scan before any mechanical dig',
        'Safe-dig drawings reviewed and on site',
        'Hand-dig within 500 mm of known services',
        'Services marked with spray paint / flags',
      ],
    },
    {
      id: 'ex_cave_in',
      name: 'Cave-in / ground collapse',
      category: 'Structural',
      suggestedControls: [
        'Trench shoring / benching / battering for excavations > 1.2 m',
        'Competent person inspects walls each shift',
        'Spoil heaped ≥ 0.6 m from edge',
        'No personnel below unsupported excavation',
      ],
    },
    {
      id: 'ex_falls_into',
      name: 'Falls into excavation',
      category: 'Gravity',
      suggestedControls: [
        'Barriers on all unattended open sides',
        'Clearly marked access / egress points',
        'Designated crossing points (bridging or stepped entry)',
        'Excavation covered or barricaded overnight',
      ],
    },
    {
      id: 'ex_water_ingress',
      name: 'Water ingress / flooding',
      category: 'Physical',
      suggestedControls: [
        'Dewatering pump on site and tested',
        'Monitor weather forecast; evacuate if heavy rain expected',
        'Do not enter flooded excavation',
        'Check for groundwater before entry',
      ],
    },
  ],
  recommended: [
    {
      id: 'ex_plant_proximity',
      name: 'Plant / vehicle proximity',
      category: 'Mechanical',
      suggestedControls: [
        'Exclusion zone for all plant near excavation',
        'Banksman / spotter for reversing vehicles',
        'Hi-vis worn by all personnel',
      ],
    },
    {
      id: 'ex_toxic_atmosphere',
      name: 'Toxic atmosphere in excavation',
      category: 'Atmosphere',
      suggestedControls: [
        'Gas test before entry (O₂, LEL, H₂S, CO)',
        'Continuous monitoring if atmosphere suspected',
        'Forced ventilation for excavations > 1.5 m depth',
      ],
    },
  ],
};

// ── Working at Height ─────────────────────────────────────────────────────────

const WORKING_AT_HEIGHT: HazardProfile = {
  required: [
    {
      id: 'wh_falls',
      name: 'Falls from height',
      category: 'Gravity',
      suggestedControls: [
        'Hierarchy: collective protection > restraint > fall arrest',
        'Secure handrail / guard rail on all open edges',
        'Full-body harness + double-lanyard attached to anchor ≥ at waist height',
        'Rescue plan in place for suspended-in-harness scenario',
      ],
    },
    {
      id: 'wh_falling_objects',
      name: 'Falling objects / tools',
      category: 'Gravity',
      suggestedControls: [
        'Exclusion zone below work area',
        'Tool lanyards on all hand tools',
        'Toe boards or netting on scaffold edges',
        'Signage and barriers at ground level',
      ],
    },
    {
      id: 'wh_fragile_surfaces',
      name: 'Fragile or sloping surfaces',
      category: 'Structural',
      suggestedControls: [
        'Crawl boards / roof ladders on fragile surfaces',
        'Do not step on roof lights or unverified panels',
        'Weight limits checked for temporary platforms',
      ],
    },
    {
      id: 'wh_scaffold_stability',
      name: 'Scaffold / work platform stability',
      category: 'Structural',
      suggestedControls: [
        'Scaffold erected / inspected by competent scaffold inspector',
        'Scaffold tag in date and visible',
        'Do not modify scaffold without scaffold supervisor approval',
        'Maximum load clearly posted',
      ],
    },
  ],
  recommended: [
    {
      id: 'wh_wind_weather',
      name: 'Wind / adverse weather',
      category: 'Physical',
      suggestedControls: [
        'Work suspended if wind ≥ 40 km/h (site-specific limit)',
        'Weather forecast checked at start of shift',
        'Secure or remove lightweight materials that could become projectiles',
      ],
    },
    {
      id: 'wh_overhead_lines',
      name: 'Overhead electrical lines',
      category: 'Electrical',
      suggestedControls: [
        'Minimum approach distance maintained (contact utility for de-energisation)',
        'Goalposts / goal-bar proximity warnings erected',
        'No metallic scaffold within exclusion zone of overhead lines',
      ],
    },
  ],
};

// ── Lifting Operations ────────────────────────────────────────────────────────

const LIFTING_OPERATION: HazardProfile = {
  required: [
    {
      id: 'lo_load_drop',
      name: 'Load drop / loss of load',
      category: 'Gravity',
      suggestedControls: [
        'Lifting plan reviewed and approved by appointed person',
        'All rigging inspected and within certification dates',
        'Load weight confirmed before lift',
        'Exclusion zone under all suspended loads',
      ],
    },
    {
      id: 'lo_crane_failure',
      name: 'Crane / equipment failure',
      category: 'Mechanical',
      suggestedControls: [
        'Pre-lift inspection by crane operator',
        'SWL / load chart verified for configuration',
        'Crane service and inspection records current',
        'Emergency lowering procedure known to operator',
      ],
    },
    {
      id: 'lo_struck_by_load',
      name: 'Struck by swinging load',
      category: 'Physical',
      suggestedControls: [
        'Tag lines used on all loads with wind catch',
        'Personnel clear of load path at all times',
        'Rigger / banksman signals agreed pre-lift',
        'Never stand under a suspended load',
      ],
    },
    {
      id: 'lo_overhead_lines',
      name: 'Overhead lines / obstructions',
      category: 'Electrical',
      suggestedControls: [
        'Overhead line survey completed and plotted on lift plan',
        'Minimum clearance distances defined and marked',
        'Goal-bar crossing guards if working near overhead lines',
      ],
    },
  ],
  recommended: [
    {
      id: 'lo_ground_conditions',
      name: 'Unsuitable ground conditions',
      category: 'Structural',
      suggestedControls: [
        'Ground bearing capacity assessed for mobile crane outriggers',
        'Crane mats / spreader plates used on soft ground',
        'Inspect ground after rain',
      ],
    },
    {
      id: 'lo_wind',
      name: 'Wind effect on load',
      category: 'Physical',
      suggestedControls: [
        'Wind speed monitored; manufacturer wind limit not exceeded',
        'Lift postponed if wind gust exceeds limit',
        'Sheet / cover loads to reduce wind catch if possible',
      ],
    },
  ],
};

// ── General Work (fallback) ───────────────────────────────────────────────────

const GENERAL_WORK: HazardProfile = {
  required: [
    {
      id: 'gw_slips_trips',
      name: 'Slips, trips and falls (same level)',
      category: 'Physical',
      suggestedControls: [
        'Housekeeping maintained throughout work',
        'Cables and hoses routed in cable protectors',
        'Adequate lighting in work area',
        'Appropriate non-slip footwear worn',
      ],
    },
    {
      id: 'gw_manual_handling',
      name: 'Manual handling / musculoskeletal strain',
      category: 'Ergonomic',
      suggestedControls: [
        'Mechanical handling aids used where load > 25 kg',
        'Team lifts for awkward loads',
        'Manual handling briefing before task',
      ],
    },
  ],
  recommended: [
    {
      id: 'gw_noise',
      name: 'Noise / vibration',
      category: 'Physical',
      suggestedControls: [
        'Hearing protection above 85 dB(A)',
        'Anti-vibration gloves for prolonged power-tool use',
        'Rotate workers to limit vibration exposure',
      ],
    },
    {
      id: 'gw_dust_fumes',
      name: 'Dust / chemical fumes',
      category: 'Chemical',
      suggestedControls: [
        'LEV / local extraction where practicable',
        'RPE selected to task (half-face, full-face)',
        'SDS consulted for all chemical substances',
      ],
    },
    {
      id: 'gw_hand_tools',
      name: 'Hand / power tool injury',
      category: 'Mechanical',
      suggestedControls: [
        'Tools inspected before use; defective tools removed from service',
        'Correct tool for task; blade guards in place',
        'Cut-resistant gloves where blades are used',
      ],
    },
  ],
};

// ── Line Break / Pipework ─────────────────────────────────────────────────────

const LINE_BREAK: HazardProfile = {
  required: [
    {
      id: 'lb_residual_pressure',
      name: 'Residual pressure / fluid release',
      category: 'Pressure',
      suggestedControls: [
        'Line isolated, depressurised and pressure gauge reads zero',
        'Bleed / vent before breaking',
        'Face shield and chemical-resistant gloves worn',
        'Absorbent materials ready for spillage',
      ],
    },
    {
      id: 'lb_toxic_contents',
      name: 'Toxic / hazardous fluid release',
      category: 'Chemical',
      suggestedControls: [
        'SDS reviewed; appropriate RPE selected',
        'Drip tray and drain isolation in place',
        'Emergency shower / eye-wash within 10 seconds travel',
        'Personnel downstream and downwind minimised',
      ],
    },
    {
      id: 'lb_unexpected_flow',
      name: 'Unexpected product flow',
      category: 'Physical',
      suggestedControls: [
        'All isolation valves locked and tagged out',
        'Blind / blank fitted at isolation boundary',
        'Operations confirmed shutdown before break',
      ],
    },
  ],
  recommended: [
    {
      id: 'lb_asbestos_insulation',
      name: 'Asbestos-containing insulation (older pipework)',
      category: 'Biological',
      suggestedControls: [
        'Asbestos register checked before disturbing insulation',
        'Licensed contractor engaged if ACM suspected',
        'Wetting technique; do not dry-sweep',
      ],
    },
  ],
};

// ── Radiation Work ────────────────────────────────────────────────────────────

const RADIATION_WORK: HazardProfile = {
  required: [
    {
      id: 'rw_irradiation',
      name: 'External irradiation',
      category: 'Radiation',
      suggestedControls: [
        'Radiation survey before entry to work zone',
        'Time / distance / shielding ALARA principles applied',
        'TLD / electronic dosimeter worn throughout',
        'Dose rate limits not exceeded',
      ],
    },
    {
      id: 'rw_contamination',
      name: 'Radioactive contamination',
      category: 'Radiation',
      suggestedControls: [
        'Contamination survey at access points',
        'Full anti-contamination clothing worn',
        'Controlled zone established; no eating / drinking / smoking',
        'Personnel monitoring on exit from controlled zone',
      ],
    },
  ],
  recommended: [
    {
      id: 'rw_source_loss',
      name: 'Loss / theft of radioactive source',
      category: 'Radiation',
      suggestedControls: [
        'Source inventory checked at start and end of each shift',
        'Source container secured when not in use',
        'Loss reporting procedure known to all operatives',
      ],
    },
  ],
};

// ── Profile map ───────────────────────────────────────────────────────────────

const PROFILES: Record<string, HazardProfile> = {
  hot_work:           HOT_WORK,
  confined_space:     CONFINED_SPACE,
  electrical_work:    ELECTRICAL_WORK,
  excavation:         EXCAVATION,
  working_at_height:  WORKING_AT_HEIGHT,
  lifting_operation:  LIFTING_OPERATION,
  general_work:       GENERAL_WORK,
  line_break:         LINE_BREAK,
  radiation_work:     RADIATION_WORK,
};

/**
 * Look up the hazard profile for a permit type.
 * Falls back to GENERAL_WORK for any unrecognised type.
 */
export function getHazardProfile(permitType: string): HazardProfile {
  return PROFILES[permitType] ?? GENERAL_WORK;
}

/** All permit types that have an explicit (non-generic) profile. */
export const PROFILED_PERMIT_TYPES = Object.keys(PROFILES).filter(k => k !== 'general_work');
