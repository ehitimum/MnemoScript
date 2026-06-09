export interface LTMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  rule: { id: string; category: { id: string; name: string } };
}

export interface LTResponse {
  matches: LTMatch[];
}

class GrammarService {
  private apiUrl = 'https://api.languagetool.org/v2/check'; // Toggle to localhost:8081 for local server

  async checkText(text: string, lang: string = 'en-US'): Promise<LTMatch[]> {
    if (!text.trim()) return [];

    const params = new URLSearchParams();
    params.append('text', text);
    params.append('language', lang);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data: LTResponse = await response.json();
      return data.matches;
    } catch (error) {
      console.error('LanguageTool Check Failed:', error);
      return [];
    }
  }
}

export const grammarService = new GrammarService();