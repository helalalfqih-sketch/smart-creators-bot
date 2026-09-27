/**
 * Filename & Metadata Formatter Utilities
 * Consistently strips hashtags from generated filenames while retaining them in captions.
 */

export interface FormattedMediaMetadata {
  rawTitle: string;
  cleanTitle: string;
  hashtags: string[];
  filename: string;
  captionTitle: string;
}

export class FilenameUtils {
  /**
   * Strips all hashtags (#word, #عربي, #tag) and emojis/special pictographs from text
   */
  public static stripHashtagsAndEmojis(text: string = ''): string {
    if (!text) return '';
    return text
      // Remove hashtags (English, Arabic, Chinese/CJK, Numbers, Underscores)
      .replace(/#[\w\u0600-\u06FF\u4e00-\u9fa5\d_-]+/gu, ' ')
      // Remove standalone hash symbols
      .replace(/#+/g, ' ')
      // Remove emojis, pictographs, symbols, dingbats, and variation selectors
      .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Modifier}/gu, ' ')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu, ' ')
      // Remove illegal filesystem characters
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      // Normalize multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Alias for backward compatibility
   */
  public static stripHashtags(text: string = ''): string {
    return this.stripHashtagsAndEmojis(text);
  }

  /**
   * Extracts all hashtags from text
   */
  public static extractHashtags(text: string = ''): string[] {
    if (!text) return [];
    const matches = text.match(/#[\w\u0600-\u06FF\u4e00-\u9fa5\d_-]+/gu);
    return matches ? Array.from(new Set(matches)) : [];
  }

  /**
   * Sanitizes a title and generates a consistent, clean filename without hashtags
   * 
   * Example:
   * "Awesome cooking trick! #food #chef #viral" -> "Awesome_cooking_trick.mp4"
   */
  public static formatFilename(
    rawTitle: string = '',
    platform: string = 'Media',
    extension: string = 'mp4',
    maxLength: number = 70
  ): string {
    const cleanExt = extension.replace(/^\./, '').toLowerCase();
    let clean = this.stripHashtags(rawTitle);

    // Remove leading/trailing non-alphanumeric punctuation (except basic Arabic/English/CJK)
    clean = clean.replace(/^[^\w\u0600-\u06FF\u4e00-\u9fa5]+|[^\w\u0600-\u06FF\u4e00-\u9fa5]+$/gu, '');

    // Fallback if title was solely hashtags or empty
    if (!clean || clean.length < 2) {
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      clean = `${platform}_${timestamp}_${randomSuffix}`;
    }

    // Limit length cleanly without cutting in the middle of a word
    if (clean.length > maxLength) {
      clean = clean.substring(0, maxLength).trim();
      const lastSpace = clean.lastIndexOf(' ');
      if (lastSpace > maxLength * 0.6) {
        clean = clean.substring(0, lastSpace).trim();
      }
    }

    // Replace spaces with underscores for standard filesystem compatibility
    const safeFilename = clean.replace(/\s+/g, '_').replace(/_{2,}/g, '_');
    return `${safeFilename}.${cleanExt}`;
  }

  /**
   * Generates comprehensive metadata separating clean title from hashtags
   */
  public static generateMetadata(
    rawTitle: string = '',
    platform: string = 'Media',
    isAudio: boolean = false
  ): FormattedMediaMetadata {
    const cleanTitle = this.stripHashtags(rawTitle) || `${platform} Media`;
    const hashtags = this.extractHashtags(rawTitle);
    const extension = isAudio ? 'mp3' : 'mp4';
    const filename = this.formatFilename(rawTitle, platform, extension);

    return {
      rawTitle,
      cleanTitle,
      hashtags,
      filename,
      captionTitle: cleanTitle,
    };
  }
}
