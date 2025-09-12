import mysql2 from "mysql2/promise";

class APIRepository {
  constructor(private baseUrl: string) {}

  async getRequest<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    if (params) {
      Object.keys(params).forEach((key) => {
        url.searchParams.append(key, params[key]);
      });
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
  
  async getSimilarDiagnoses(diagnosis: string): Promise<string[]> {
    try {
      const response = await this.getRequest<any>("/diagnoses/similar", {
        diagnosis: encodeURIComponent(diagnosis),
      });
      return response.diagnoses;
    } catch (error) {
      console.error("API Error - getSimilarDiagnoses:", error);
      throw new Error("Failed to get similar diagnoses");
    }
  }

  async getSections(diagnosis: string): Promise<string[]> {
    try {
      const response = await this.getRequest<any>(`/diagnoses/${encodeURIComponent(diagnosis)}/sections`, {});
      return response.sections;
    } catch (error) {
      console.error("API Error - getDiagnosisSections:", error);
      throw new Error("Failed to get diagnosis sections");
    }
  }

  async getSection(diagnosis: string, section: string): Promise<string> {
    try {
      const response = await this.getRequest<any>(
        `/diagnoses/${encodeURIComponent(diagnosis)}/sections/${encodeURIComponent(section)}`,
        {}
      );
      return response.content;
    } catch (error) {
      console.error("API Error - getSectionContent:", error);
      throw new Error("Failed to get section content");
    }
  }
}

export { APIRepository };
