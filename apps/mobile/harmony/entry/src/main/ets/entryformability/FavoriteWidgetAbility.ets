import { FormExtensionAbility, formBindingData } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'AiMDWidget';

/** Provides the static one-tap favourite card. */
export default class FavoriteWidgetAbility extends FormExtensionAbility {
  onAddForm(want: Want) {
    hilog.info(0x0000, TAG, 'onAddForm %{public}s', JSON.stringify(want));
    return formBindingData.createFormBindingData({});
  }
}
