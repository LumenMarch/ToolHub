from django import forms


class CsvCompareForm(forms.Form):
    source_file = forms.FileField(label="基准 CSV")
    target_file = forms.FileField(label="目标 CSV")
    key_column = forms.CharField(label="主键字段", max_length=120, help_text="例如 employee_id")
    ignore_case = forms.BooleanField(label="忽略大小写", required=False, initial=True)
    trim_whitespace = forms.BooleanField(label="去除首尾空格", required=False, initial=True)

    def clean(self):
        cleaned = super().clean()
        for name in ("source_file", "target_file"):
            file = cleaned.get(name)
            if file and not file.name.lower().endswith(".csv"):
                self.add_error(name, "请上传 CSV 文件")
        return cleaned
