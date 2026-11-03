import WidgetKit
import SwiftUI

private let aimdIndigo = Color(red: 79 / 255, green: 70 / 255, blue: 229 / 255)
private let aimdPurple = Color(red: 99 / 255, green: 102 / 255, blue: 241 / 255)

private struct FavoriteEntry: TimelineEntry {
    let date: Date
}

private struct FavoriteProvider: TimelineProvider {
    func placeholder(in context: Context) -> FavoriteEntry {
        FavoriteEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (FavoriteEntry) -> Void) {
        completion(FavoriteEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FavoriteEntry>) -> Void) {
        completion(Timeline(entries: [FavoriteEntry(date: Date())], policy: .never))
    }
}

private struct FavoriteWidgetView: View {
    @Environment(\.widgetFamily) private var family

    private var compact: Bool { family == .systemSmall }

    var body: some View {
        Group {
            if #available(iOSApplicationExtension 17.0, *) {
                card.containerBackground(for: .widget) {
                    LinearGradient(colors: [aimdIndigo, aimdPurple], startPoint: .topLeading, endPoint: .bottomTrailing)
                }
            } else {
                card.background(
                    LinearGradient(colors: [aimdIndigo, aimdPurple], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
            }
        }
        .widgetURL(URL(string: "aimarkdown://favorite"))
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: compact ? 6 : 8) {
            Image(systemName: "bookmark.fill")
                .font(.system(size: compact ? 22 : 24, weight: .semibold))
                .foregroundStyle(.white)
            Spacer(minLength: 0)
            Text("收藏链接")
                .font(.system(size: compact ? 15 : 17, weight: .semibold))
                .foregroundStyle(.white)
            if !compact {
                Text("打开 AiMD 粘贴链接")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.82))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(compact ? 14 : 16)
    }
}

@main
struct AiMDWidgets: Widget {
    private let kind = "AiMDFavoriteWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FavoriteProvider()) { _ in
            FavoriteWidgetView()
        }
        .configurationDisplayName("AiMD 收藏")
        .description("一键打开收藏链接输入框")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
