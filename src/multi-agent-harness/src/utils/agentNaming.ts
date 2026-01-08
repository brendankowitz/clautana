/**
 * Utility for generating unique agent names in the format: <descriptive>-<random>
 * Examples: reviewer-guacamole, developer-octo-spork, architect-crispy-robot
 */

// Random adjectives for name generation
const ADJECTIVES = [
  'happy', 'clever', 'swift', 'brave', 'bright',
  'calm', 'crispy', 'daring', 'eager', 'fancy',
  'gentle', 'jolly', 'keen', 'lively', 'mighty',
  'noble', 'proud', 'quick', 'wise', 'witty',
  'zippy', 'bold', 'cool', 'epic', 'fiery',
  'good', 'hardy', 'icy', 'jazzy', 'kind',
  'loyal', 'mystic', 'neat', 'optimal', 'playful',
  'quiet', 'rapid', 'sturdy', 'trusty', 'unique',
  'vivid', 'wild', 'young', 'zesty', 'agile',
];

// Random nouns for name generation
const NOUNS = [
  'robot', 'spork', 'panda', 'koala', 'gecko',
  'octopus', 'fox', 'wolf', 'hawk', 'eagle',
  'tiger', 'lion', 'bear', 'shark', 'whale',
  'dragon', 'phoenix', 'unicorn', 'griffin', 'wizard',
  'knight', 'ninja', 'samurai', 'viking', 'pirate',
  'guacamole', 'burrito', 'taco', 'nacho', 'salsa',
  'cookie', 'waffle', 'pancake', 'muffin', 'donut',
  'pixel', 'byte', 'chip', 'matrix', 'vector',
  'quantum', 'photon', 'neutron', 'pulsar', 'quasar',
];

/**
 * Generate a unique agent name with format: <descriptive> or <descriptive>-<random>
 * @param descriptive - The descriptive part (role/type), will be kebab-cased
 * @param existingNames - Set of existing agent names to ensure uniqueness
 * @returns A unique agent name like "reviewer" or "reviewer-guacamole" if collision
 */
export function generateUniqueAgentName(
  descriptive: string,
  existingNames: Set<string> = new Set()
): string {
  // Convert descriptive to kebab-case
  const kebabDescriptive = descriptive
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // First, try the descriptive name as-is (no random suffix)
  if (!existingNames.has(kebabDescriptive)) {
    return kebabDescriptive;
  }

  // If collision, try up to 100 times to generate a unique name with random suffix
  for (let attempt = 0; attempt < 100; attempt++) {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const randomPart = `${adjective}-${noun}`;
    const fullName = `${kebabDescriptive}-${randomPart}`;

    if (!existingNames.has(fullName)) {
      return fullName;
    }
  }

  // Fallback: append timestamp if we can't find a unique combo after 100 tries
  const timestamp = Date.now().toString(36);
  return `${kebabDescriptive}-${timestamp}`;
}

/**
 * Extract the descriptive part from an agent name
 * @param agentName - Full agent name like "reviewer-guacamole"
 * @returns The descriptive part like "reviewer"
 */
export function getDescriptivePart(agentName: string): string {
  // Find the last occurrence of a pattern that looks like adjective-noun
  const parts = agentName.split('-');
  if (parts.length >= 3) {
    // Assume last two parts are adjective-noun
    return parts.slice(0, -2).join('-');
  }
  // If format doesn't match, return as-is
  return agentName;
}
