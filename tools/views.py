from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.shortcuts import render

from .forms import CsvCompareForm
from .services import compare_csv_files


@login_required
def dashboard(request):
    tools = [
        {"name": "CSV 数据对比", "description": "比较两份 CSV 的新增、删除与字段变化", "url": "csv_compare", "status": "可用"},
        {"name": "CSV 数据清洗", "description": "去重、空值处理和格式标准化", "url": "#", "status": "规划中"},
        {"name": "Excel 合并", "description": "批量合并结构一致的工作表", "url": "#", "status": "规划中"},
    ]
    return render(request, "tools/dashboard.html", {"tools": tools})


@login_required
def csv_compare(request):
    result = None
    form = CsvCompareForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        try:
            result = compare_csv_files(
                form.cleaned_data["source_file"],
                form.cleaned_data["target_file"],
                form.cleaned_data["key_column"],
                form.cleaned_data["trim_whitespace"],
                form.cleaned_data["ignore_case"],
            )
        except Exception as exc:
            messages.error(request, str(exc))
    return render(request, "tools/csv_compare.html", {"form": form, "result": result})
