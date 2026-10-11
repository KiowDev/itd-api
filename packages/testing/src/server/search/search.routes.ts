import { HttpMethod } from '../../http/http.constants.js';
import { apiResponse } from '../../http/responses.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';

export function registerSearchRoutes({ services, presenters, route }: MockRouteContext): void {
  route(HttpMethod.Get, '/api/search', (request) => {
    const results = services.search.search(request.query.get('q') ?? '');
    return apiResponse(presenters.search.results(results));
  });
}
