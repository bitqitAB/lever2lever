import {AxiosInstance, default as Axios} from "axios";
import * as config from "config";
import * as fs from "fs";
import {Archived} from "../server/domain/entities/lever/Application";

const FormData = require("form-data");

declare type ApiResponse = {
    status: number;
    data: any;
    error?: any;
};

export class LeverApiService {
    private axios: AxiosInstance;
    private leverApiKey: string;

    constructor(leverApiKey: string, sourceApiKey: boolean, isSandbox: boolean) {
        this.leverApiKey = leverApiKey;
        let headers = {};

        this.axios = Axios.create({
            baseURL: isSandbox ? config.get("lever.baseUrl") : config.get("lever.prodUrl"),
            auth: {
                username: sourceApiKey === true ? config.get("lever.sourceKey") : config.get("lever.targetKey"),
                password: ""
            },
            headers: headers
        });
    }

    async listAllOpp(limit?: Number, offset?: string, createdAtStart?: Date): Promise<any> {
        let requestParams: any = {
            limit: limit,
        };

        if (createdAtStart) requestParams['created_at_start'] = createdAtStart.valueOf();

        if (offset)
            requestParams.offset = offset;

        let allParams = ["expand=applications", "expand=stage", "expand=owner", "expand=followers", "expand=sourcedBy", "expand=contact"];

        return await this.axios.get(`/opportunities?${allParams.join("&")}`, {params: requestParams})
            .catch(e => e.response);
    }

    async getPostings(limit?: Number, offset?: string,): Promise<any> {
        let requestParams: any = {
            limit: limit,
        };

        if (offset)
            requestParams.offset = offset;

        return await this.axios.get(`/postings`, {params: requestParams}).catch(e => e.response)
    }

    async getProfileForm(oppId: string): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/opportunities/${oppId}/forms`).catch(e => e.response);
        return this.parseResponse(res);
    }

    async getFiles(oppId: string): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/opportunities/${oppId}/files`).catch(e => e.response);
        return this.parseResponse(res);
    }

    async getResumes(oppId: string): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/opportunities/${oppId}/resumes`).catch(e => e.response);
        return this.parseResponse(res);
    }

    async getNotes(oppId: string): Promise<{ status: number, data: any }> {
        let response = await this.axios.get(`/opportunities/${oppId}/notes`).catch(e => e.response);
        return this.parseResponse(response);
    }

    async downloadResumes(oppId: string, resumeId: string, status?: string): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/opportunities/${oppId}/resumes/${resumeId}/download`, {responseType: "stream"}).catch(e => e.response);
        return this.parseResponse(res);
    }

    async downloadOfferFile(oppId: string, offerId: string): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/opportunities/${oppId}/offers/${offerId}/download`, {responseType: "stream"}).catch(e => e.response);
        return this.parseResponse(res);
    }

    async downloadFiles(oppId: string, fileId: string): Promise<{ status: number, data: any }> {
        return await this.handle429Response(`/opportunities/${oppId}/files/${fileId}/download`, 0)
    }

    async getOffers(oppId: string): Promise<{ status: number, data: any }> {
        let response = await this.axios.get(`/opportunities/${oppId}/offers`).catch(e => e.response);
        return this.parseResponse(response);
    }

    async getFeedbackForm(oppId: string): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/opportunities/${oppId}/feedback`).catch(e => e.response);
        return this.parseResponse(res);
    }

    async getArchiveReasons(type?: string): Promise<{ status: number, data: any }> {
        let params = {
            type: type
        };
        let res = await this.axios.get(`/archive_reasons`, {params}).catch(e => e.response);
        return this.parseResponse(res);
    }

    async getStages(): Promise<{ status: number, data: any }> {
        let res = await this.axios.get(`/stages`).catch(e => e.response).catch(e => e.response);
        return this.parseResponse(res);
    }

    async addOpportunityWithMultipart(
        performAs: string,
        data: any,
        resumeFile: string,
        files?: string[]
    ): Promise<{ data: any; error: any; status: number }> {
        let formData = new FormData();

        Object.keys(data).forEach((x) => {
            try {
                if (x === "phones") {
                    data[x].forEach((x) => {
                        formData?.append(`phones[][value]`, x.value);
                    });
                } else if (x === "archived") {
                    if (data[x]?.reason) {
                        const archived = data[x] as Archived;
                        formData?.append("archived[reason]", archived.reason);
                        formData?.append("archived[archivedAt]", archived.archivedAt)
                    }
                } else if (data[x] instanceof Array) {
                    if (data[x].length) {
                        data[x].forEach((y, i) => {
                            formData.append(`${x}[]`, y);
                        });
                    }
                } else {
                    formData?.append(`${x}`, data[x]);
                }
            } catch (e) {
                console.log(e, `Error creating form data ${x} for candidate ${JSON.stringify(data)}`);
            }
        });

        if (files && files.length) {
            files.forEach((filePath, i) => {
                formData.append("files[]", fs.createReadStream(filePath));
            });
        }

        if (resumeFile) {
            formData.append("resumeFile", fs.createReadStream(resumeFile));
        }

        let response = await this.getResponse(`/opportunities?perform_as=${performAs}`, formData);

        return {
            status: response.status ? response.status : -1,
            data: response.data,
            error: response.error
        };
    }

    async getUser(email: string): Promise<any> {
        let requestParams: any = {
            email: email,
        };

        let res = await this.axios.get(`/users`, {params: requestParams}).catch(e => e.response);
        return this.parseResponse(res)
    }

    async addNote(leverId: string, note: string, isSecret: boolean) {
        let data = {value: note, secret: isSecret};
        return this.getResponse(`/opportunities/${leverId}/notes`, data).catch((e) => e.response)
    }

    async handle429Response(url: string, recursionFactor: number = 0): Promise<ApiResponse> {
        const response: any = await this.axios
            .get(url, {
                responseType: "stream",
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
            .catch(e => {
                return e.response;
            });

        if (response?.status === 429 && recursionFactor < 20) {
            const requestAllowed = 11;

            console.log(`Retrying opp request due to 429`);

            if (requestAllowed <= 6 && requestAllowed >= 4) {
                await this.sleep(10000);
            } else if (requestAllowed <= 4 && requestAllowed >= 2) {
                await this.sleep(20000);
            } else {
                await this.sleep(30000);
            }

            return this.handle429Response(url, ++recursionFactor);

        } else if (response?.status === 429 && recursionFactor > 20) {
            console.error(
                new Error(`Max Retry attempts for Lever API already done for URL[${url}]`)
            );
        }
        return this.parseResponse(response);
    }

    async handle429Requests(url: string, data: any, recursionFactor: number = 0): Promise<ApiResponse> {
        const response: any = await this.axios
            .post(url, data, {
                headers: {
                    "Content-Type": "application/json"
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
            .catch(e => {
                return e.response;
            });

        if (response?.status === 429 && recursionFactor < 20) {
            const requestAllowed = 11;

            if (requestAllowed <= 6 && requestAllowed >= 4) {
                await this.sleep(10000);
            } else if (requestAllowed <= 4 && requestAllowed >= 2) {
                await this.sleep(20000);
            } else {
                await this.sleep(30000);
            }

            return this.handle429Requests(url, data, ++recursionFactor);

        } else if (response?.status === 429 && recursionFactor > 20) {
            console.error(
                new Error(`Max Retry attempts for Lever API already done for URL[${url}]`)
            );
        }
        return this.parseResponse(response);
    }

    async uploadOppFiles(oppId: string, filePath: string, performAs: string): Promise<any> {
        let formData = new FormData();

        formData.append("file", fs.createReadStream(filePath));

        return await this.handle429Requests(`/opportunities/${oppId}/files?perform_as=${performAs}`, formData)
    }

    async getResponse<T>(url: string, body: any, recursionFactor: number = 0): Promise<ApiResponse> {
        const response: any = await this.axios
            .post(url, body, {
                headers: {
                    "Content-Type": "application/json"
                },

                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
            .catch((e) => {
                console.log(e?.message);
                return e?.response
            });

        if (response?.status === 429 && recursionFactor < 20) {
            const requestAllowed = response?.headers["X-RateLimit-Remaining"] ?? 11;

            if (requestAllowed <= 6 && requestAllowed >= 4) {
                await this.sleep(10000);
            } else if (requestAllowed <= 4 && requestAllowed >= 2) {
                await this.sleep(20000);
            } else {
                await this.sleep(30000);
            }
            return this.getResponse(url, body, ++recursionFactor);
        } else if (response?.status === 429 && recursionFactor > 20) {
            console.error(
                new Error(`Max Retry attempts for Lever API already done for URL[${url}] with body [${JSON.stringify(body)}]`)
            );
        }

        return this.parseResponse(response);
    }

    parseResponse(response: any): ApiResponse {
        let data;
        // console.log('inside parse res')
        if (response) {
            if (response.data) {
                if (response.data.data) {
                    data = response.data.data;
                } else {
                    data = response.data;
                }
            } else {
                data = response;
            }
        } else {
            data = -1;
        }
        return {
            status: response ? response.status : -1,
            data: data,
        };
    }

    async sleep(ms: number = 0) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

}

