from django.urls import path
from . import views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("tools/csv-compare/", views.csv_compare, name="csv_compare"),
]
