import { Agent, request } from "undici";
import { create as contentDisposition } from "content-disposition-header";

import { destroyInternalStream } from "./manage.js";
import { getHeaders, closeRequest, closeResponse, pipe } from "./shared.js";
import { logger, logError } from "../util/logger.js";

const defaultAgent = new Agent();

export default async function (streamInfo, res) {
    const abortController = new AbortController();
    const shutdown = () => (
        closeRequest(abortController),
        closeResponse(res),
        destroyInternalStream(streamInfo.urls)
    );

    try {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-disposition', contentDisposition(streamInfo.filename));

        const requestHeaders = {
            ...getHeaders(streamInfo.service),
            ...(streamInfo.headers || {}),
            Range: streamInfo.range
        };
        
        // Remove undefined values
        Object.keys(requestHeaders).forEach(key => {
            if (requestHeaders[key] === undefined) {
                delete requestHeaders[key];
            }
        });
        
        
        const { body: stream, headers, statusCode } = await request(streamInfo.urls, {
            headers: requestHeaders,
            signal: abortController.signal,
            maxRedirections: 16,
            dispatcher: defaultAgent,
        });

        res.status(statusCode);

        for (const headerName of ['accept-ranges', 'content-type', 'content-length']) {
            if (headers[headerName]) {
                res.setHeader(headerName, headers[headerName]);
            }
        }

        pipe(stream, res, shutdown);
    } catch (error) {
        logError(error, {
            url: streamInfo.urls,
            service: streamInfo.service,
            hasHeaders: !!streamInfo.headers,
            headersKeys: streamInfo.headers ? Object.keys(streamInfo.headers) : []
        }, 'Proxy request failed');
        shutdown();
    }
}
