@Entry
@Component
struct FavoriteWidgetCard {
  build() {
    Column() {
      Row() {
        Image($r('app.media.favorite_widget_bookmark'))
          .width(26)
          .height(26)
          .objectFit(ImageFit.Contain)
          .margin({ right: 12 })

        Column() {
          Text('收藏链接')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFF')
            .maxLines(1)
          Text('打开 AiMD 粘贴链接')
            .fontSize(11)
            .fontColor('#E0E0FF')
            .margin({ top: 2 })
            .maxLines(1)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .padding(16)
    .justifyContent(FlexAlign.Center)
    .linearGradient({
      angle: 90,
      colors: [['#4F46E5', 0.0], ['#6366F1', 1.0]]
    })
    .borderRadius(20)
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility',
        params: { aimdAction: 'open-favorite' }
      });
    })
  }
}
