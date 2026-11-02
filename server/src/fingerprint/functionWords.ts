// The 150 most common English function words: pronouns, prepositions,
// conjunctions, determiners, auxiliaries, particles. Stable per author,
// hard to fake consciously — see SPEC.md Stage 2, Layer 1.
export const FUNCTION_WORDS: string[] = [
  "the", "of", "and", "a", "to", "in", "is", "you", "that", "it",
  "he", "was", "for", "on", "are", "as", "with", "his", "they", "i",
  "at", "be", "this", "have", "from", "or", "one", "had", "by", "word",
  "but", "not", "what", "all", "were", "we", "when", "your", "can", "said",
  "there", "use", "an", "each", "which", "she", "do", "how", "their", "if",
  "will", "up", "other", "about", "out", "many", "then", "them", "these", "so",
  "some", "her", "would", "make", "like", "him", "into", "time", "has", "look",
  "two", "more", "write", "go", "see", "number", "no", "way", "could", "people",
  "my", "than", "first", "been", "call", "who", "its", "now", "find", "long",
  "down", "day", "did", "get", "come", "made", "may", "part", "over", "new",
  "sound", "take", "only", "little", "work", "know", "place", "year", "live", "me",
  "back", "give", "most", "very", "after", "thing", "our", "just", "name", "good",
  "sentence", "man", "think", "say", "great", "where", "help", "through", "much", "before",
  "line", "right", "too", "mean", "old", "any", "same", "tell", "boy", "follow",
  "came", "want", "show", "also", "around", "form", "three", "small", "set", "put",
  "end", "does", "another", "well", "large", "must", "big", "even", "such", "because",
];

export const FUNCTION_WORD_SET = new Set(FUNCTION_WORDS);
