//
//  SafariWebExtensionHandler.swift
//  MoviePeek Extension
//
//  Fetches IMDb suggestion JSON natively, so the lookup doesn't depend on
//  Safari granting the extension access to IMDb's domain.
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?["message"] as? [String: Any]

        guard let urlString = message?["fetch"] as? String,
              let url = URL(string: urlString),
              ["v3.sg.media-imdb.com", "caching.graphql.imdb.com"].contains(url.host ?? "") else {
            reply(context, ["error": "bad request"])
            return
        }

        var req = URLRequest(url: url)
        if let body = message?["body"] as? String {
            req.httpMethod = "POST"
            req.httpBody = body.data(using: .utf8)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("imdb-web-next-localized", forHTTPHeaderField: "x-imdb-client-name")
        }

        URLSession.shared.dataTask(with: req) { data, _, error in
            if let data, let body = String(data: data, encoding: .utf8) {
                self.reply(context, ["body": body])
            } else {
                os_log(.error, "IMDb fetch failed: %@", String(describing: error))
                self.reply(context, ["error": error?.localizedDescription ?? "no data"])
            }
        }.resume()
    }

    private func reply(_ context: NSExtensionContext, _ payload: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = ["message": payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
