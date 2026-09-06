// Viewer-request rewrite for a static site on an S3 REST origin.
//
// S3's REST API has no directory-index behaviour, so /blog/ asks for the key
// "blog/" which does not exist and returns 403. Astro emits every page as
// <path>/index.html, so map the visitor URL onto that key.
//
// Written in ES5 (no endsWith/includes) so it runs on either CloudFront
// Functions runtime.
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    if (uri.charAt(uri.length - 1) === '/') {
        request.uri = uri + 'index.html';
    } else if (uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {
        // No extension in the final segment: /about -> /about/index.html.
        // Comparing the last dot to the last slash keeps /a.b/c working.
        request.uri = uri + '/index.html';
    }
    return request;
}
