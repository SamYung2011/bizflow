import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const LOGO_B64 = "iVBORw0KGgoAAAANSUhEUgAACH0AAAEyCAYAAABtOj5tAAAACXBIWXMAACxKAAAsSgF3enRNAAAgAElEQVR4nOzdzXXcxrY/bPguz6k3AhITDDAh/xGINwLxREA6AtMRiIrArQhMRmAqApMRHHGCASYQI7jqCPQuyJt265sfQFcBeJ61uO45Z3DVXWh8Vf32rp8+fPhQQAplVR8URfGsKIq7/8tyXHVtc+V4AwAAAAAAADzez8aOsZVVfRfsOIz/2//tGvjFWhdFcb70QQAAAAAAAAB4KqEPRhFdPI7ib98os2HVtc07AwIAAAAAAADwNLZ3YTBlVe8VRXEaQQ+dPPia265t9owMAAAAAAAAwNPp9MGTlVV9UhRF//fcaPIDJwYIAAAAAAAAYBhCHzxKWdXPoqvHia4e3NObrm2uDBYAAAAAAADAMIQ+eLCyqs8i8LFj9LindfxmAAAAAAAAABiI0Af3Vlb1UVEUK509eIRV1zbvDBwAAAAAAADAcH768OGD4eS7yqreK4rivCiK50aKR7jt2mbPwAEAAAAAAAAM63+MJ99TVnW/JcdbgQ+e4MTgAQAAAAAAAAzP9i58VVnVz4qiuBT24Ikuura5MogAAAAAAAAAw9Ppgy+UVX1YFMU7gQ+eaF0UxalBBAAAAAAAABiH0AefiO1c/iqKYsfI8ERnXdu8N4gAAAAAAAAA4/jpw4cPhpaPyqo+L4ri2GgwgJuubQ4MJAAAAAAAAMB4fja2lFX9rCiKlcAHA7KtCwAAAAAAAMDIhD4WLgIfV0VR7C99LBjMRdc2V4YTAAAAAAAAYFz/Y3yXS+CDEax1+QAAAAAAAADYDqGPZVsJfDCws65t3htUAAAAAAAAgPH99OHDB8O8QGVVnxdFcbz0cWBQN13bHBhSAAAAAAAAgO3Q6WOByqo+FfhgBLZ1AQAAAAAAANgioY+FKav6qCiK35c+DgzuomubK8MKAAAAAAAAsD1CHwtSVvVeURTnSx8HBrfW5QMAAAAAAABg+4Q+luWyKIqdpQ8Cgzvr2ua9YQUAAAAAAADYLqGPhSir+qwoiv2ljwODu+naZmVYAQAAAAAAALZP6GMByqo+KIri5dLHgVHY1gUAAAAAAAAgEaGPZThf+gAwiouuba4MLQAAAAAAAEAaQh8zV1b1qW1dGMFalw8AAAAAAACAtIQ+Zqys6mdFUZwtfRwYxVnXNu8NLQAAAAAAAEA6Qh/ztiqKYmfpg8Dgbrq2WRlWAAAAAAAAgLSEPmaqrOrDoiiOlz4OjMK2LgAAAAAAAAAZEPqYL50YGMNF1zZXRhYAAAAAAAAgPaGPGSqruu/EsL/0cWBwa10+AAAAAAAAAPIh9DEzZVU/K4ribOnjwCjOurZ5b2gBAAAAAAAA8iD0MT/9ti47Sx8EBnfTtY0tgwAAAAAAAAAyIvQxI2VVHxZFcbz0cWAUtnUBAAAAAAAAyIzQx7zoxMAYLrq2uTKyAAAAAAAAAHkR+piJsqr7Tgz7Sx8HBrfW5QMAAAAAAAAgT0IfM1BW9bOiKM6WPg6M4qxrm/eGFgAAAAAAACA/Qh/z0G/rsrP0QWBwN13b2DIIAAAAAAAAIFNCHxNXVvVhURTHSx8HRmFbFwAAAAAAAICMCX1Mn04MjOGia5srIwsAAAAAAACQL6GPCSuruu/EsL/0cWBwa10+AAAAAAAAAPIn9DFRZVU/K4ribOnjwCjOurZ5b2gBAAAAAAAA8ib0MV39ti47Sx8EBnfTtY0tgwAAAAAAAAAmQOhjgsqqPiyK4njp48AobOsCAAAAAAAAMBFCH9OkEwNjuOja5srIAgAAAAAAAEyD0MfElFXdd2LYX/o4MLi1Lh8AAAAAAAAA0yL0MSFlVT8riuJs6ePAKM66tnlvaAEAAAAAAACmQ+hjWvptXXaWPggM7qZrG1sGAQAAAAAAAEyM0MdElFV9WBTF8dLHgVHY1gUAAAAAAABggoQ+pkMnBsZw0bXNlZEFAAAAAAAAmB6hjwkoq7rvxLC/9HFgcGtdPgAAAAAAAACmS+gjc2VVPyuK4mzp48Aozrq2eW9oAQAAAAAAAKZJ6CN//bYuO0sfBAZ307WNLYMAAAAAAAAAJkzoI2NlVR8WRXG89HFgFLZ1AQAAAAAAAJg4oY+86cTAGC66trkysgAAAAAAAADTJvSRqbKq+04M+0sfBwa31uUDAAAAAAAAYB6EPjJUVvWzoijOlj4OjOKsa5v3hhYAAAAAAABg+oQ+8tRv67Kz9EFgcDdd29gyCAAAAAAAAGAmhD4yU1b1YVEUx0sfB0ZhWxcAAAAAAACAGRH6yI9ODIzhomubKyMLAAAAAAAAMB9CHxkpq7rvxLC/9HFgcGtdPgAAAAAAAADmR+gjE2VVPyuK4mzp48Aozrq2eW9oAQAAAAAAAOZF6CMf/bYuO0sfBAZ307WNLYMAAAAAAAAAZkjoIwNlVR8WRXG89HFgFLZ1AQAAAAAAAJgpoY886MTAGC66trkysgAAAAAAAADzJPSRWFnVfSeG/UUPAmNY6/IBAAAAAAAAMG9CHwmVVf2sKIqzxQ4AYzrr2ua9EQYAAAAAAACYL6GPtPptXXaWPACM4qZrG1sGAQAAAAAAAMyc0EciZVUfFkVxvMgvz9hs6wIAAAAAAACwAEIf6ejEwBguura5MrIAAAAAAAAA8yf0kUBZ1X0nhv3FfXHGttblAwAAAAAAAGA5hD62rKzqZ0VRnC3qS7MtZ13bvDfaAAAAAAAAAMsg9LF9/bYuO0v70ozupmsbWwYBAAAAAAAALIjQxxaVVX1YFMXxYr4w22RbFwAAAAAAAICFEfrYLp0YGMNF1zZXRhYAAAAAAABgWYQ+tqSs6r4Tw/4ivizbtNblAwAAAAAAAGCZhD62oKzqZ0VRnM3+i5LCWdc27408AAAAAAAAwPIIfWxHv63LzhK+KFt107WNLYMAAAAAAAAAFuqnDx8+OPYjKqv6sCiKv2b7BUnptiiKd44ADOZd/F11bXNlWAEAAAAAAMid0MfIyqp+WxTF/qy/JMA8XRRFcS4AAgAAAAAAQK6EPkZUVvVpURS/z/YLAizDdVEUJ13b6KyzAGVV7xVFsTfiN33ftc3bpY9zbsqqPiiK4tmIH+tt1zbvpzk6edjCMZoy15UEoqPjaIRO8zb288JUj7/zYtmcF1839nnxmXfeW9nmc7Pr8vZt+ZoyNd67t6ys6v5aczDiv+q+lrmRr0mO/xNtYZ570ub4HCP0MZK44fUXpJ1ZfkGAZVkXRXHatc254z5PZVWfFEVxVhTF7ha+YP97WnVtc7bEsc5FPKv1x+DXLX2k27iOXOY/OuPaeOm8+/t8ouj5HL93Atcb/2QfCnm/sZWZyZN7Kqv6qCiKw/iNHiR6v7vb1vFt/F05fmlEYcfZln4HF3HfyG7xIiZ37/72tvT89DnnRSbiOrna0u8gy0B+PNtsnhM5PMvcnSNXsRC6+GfQOcnwN7feuB73f5cW339sI6Bzt2i6uTiX6v46N3e/zSLeh+7+8937kaDIPWR0zbmJ43Zle+50Yj6tf/Y73sKHMIcaNkJWm3Nom6GbVPMVc3P3DF1szKHd3T+yL7oS+hhJWdXnW7roAbA9F13bnBjveYmJ6j8TfKlXXlrSSfis9r9LmZjYeCG9mxg6sO1hdm42Fk2vTHr+LSY1++vzUcaTJtexDZ1A6pZEQPSPLf+z113bZFHRG9f00/jL9by4iUlh58WWRADory3/s7dd22RRsRjf/2wigdV+0aQPfpwJSE1X3ItOJvKbexPX5MUvysaz5cFn70YCHfn4PLT0VifFv03gPufelkBZ1VcJfhO/LOkZP0KBm3NpAh15+SRcHfeNLK5BQh8jSPTSC8B2CH7MTFnV7xJNuKy7trFdRQKxcPV/if75N13bHCUdgJHEuG5Wfwt4TNPNXeVUVE8tKgRSVnU/qfkyg49yXzdR9W5iemRlVb9NdF37f6mP75Y7nAzhNs6LxS80jq2s6n6h5UWCf/o/KTtXxALu+YS7k73u2uY0g8/BPcXiz2qiv7k3cU1ezDNlXCOONt6LLNRN03W8E10u7Vl7ove51xH+WHwRw5jifvTfBP90NqHfMXzWSVH322m6vet2lrILpdDHCBJOBgGwHYtKF89dWdUpH4ZK1Qjblzqg27XNTwm//qAi6HEUfykWfRjfdby0Xs75ehW/5csJT7D81rXNKoPPMVsJnxeSPndOvIuphe2RJQxPJ+uYF4sdVzNYxO1Dg4cWx/IX3T1WE//NzT6kGteGk3gv0sVjftYb70Sz3i5r4ve5ftH1SCB+PCnn0+Y0l1b823n6KPMOozzeXUHV+TavSf/jgA0rKmAEPgDm7Y94CYKnmm1KnXnrX06juvf/YrsDgY/56kMQv/dzLP0xj4mJOUrRonZIv8fiPPOT7FlhBtvW/hrXLZ3VxrOohc0ZBT6KmLu8cn7kbWNrsan/5vrf2/ncfm/99+nXAiIA11e+/yrwMVs78Uz0Z1nV7/tnpOiGMSszuM/txr1Nh+bxZLH15FT151hcP97HVuPHAh+ztR/PBf/tG0XE88Loz0FCHwOKA2ZvfoBlUE0LLMpnk5p/Cnos0ouY6HzXb4Myl4n7sqpXMwnuHwt+MJTY6mjKgY87LyxsM6DzmU3MC35kLKqp/5jRV9qPc2jy+sX+eOb6vwhHC3osy10ApA/FX8W5OnkbnQ+nfp/biWI9wQ+yEYVTVxEQFPRYnv14Xng3dmhQ6GNYU2+1B8D9PZ/Lix3Aj8Ti3zuTmoT+N/AyXlgnHf6Ie/mvGXyUoQh+8GQxCfVyRiO5L7DNU8Xi0Rw7+zo/MrSx+Do3L6Y8j7IR9uhmEozk6fpOgX/NJPxxNrN3fV2aSa6/LvRdHqJwasqdRRnGZmhwlPCH0MdA4qbuYQ9gWewRDsxaVCO8i8U/4WY+txO/jbcT3vZljp0aj2PbUXisuZ4XAlE8xZw7+x7PePu2qZpbV5lNk3tGiY6HZ8IefMdm+GNy277EZ55TEP7OleAHKURIsO/s8ddMQ8M83XHMpQ1aSCX0MRypeIDleaEVLjBHMbF5GdUIOnvwI7ux7cvllO6LMQE412qb33Uk4zHiHJ7rgtaxVt88RgQi5v48tPJum4f4vc15G8UXU1oUj+eptzPrgMV4nt8t4k1sjOcaGO/Dc+fub2zTRkhQZw9+ZLOQapD5G6GPAUQVlbQWwDKpiAJmJV403s18splxvIgtX6Zyb5z74u/lFCsNSW7u54VW3zzGEkJ0uzpZZmMJhYWTeFYsq3oVVdpC8DzEx0W86PoxlbDBnOc296N7EowqunsICfIYu9Et6smBwZ8N/9PEjXvOLR5J56YoivfGvzjQTp7MHXp5AOYiwsy/O6A8wU50/XjVtU3u70lzD272x+IynqfhvpYQaO4DUQdd23jf5r6WEvQ/7Re5nRvpRDeiJQQMDnMOt8R8/6UqbZ7oeQTiD7u2eZvrYEYYdu7Xnb7D0NkE3k+ZqCieurSOxRO9jN/S0WOfx4U+nm7lRGYEN13bmJzdcHexiz8Je3KighaYhbKqz+1RzYD6l9W9rm2y7BoQHTCW8Ey5Hwt4qre5ryUscO1GaFvHPn4oFn+XMgexE90+LIqls5Sxz3bOMxbAz3X1ZiD9dfW/ZVX/0rVNrgVjS3ke+th9pWubqww+CzMSgc0/HFMG0r+PX0Vg8MHBD9u7PEEsQpsYZwwmZT/TP5D1k9Vd2/QT9L8URXGb1QdkyewLCUyewAcjOY7fVo6WFLD+NSai4LuG2kd4Il5Edyv4kaUV5JxOaDuCWVlQl4/ebo6/swh8XAl8MII/Mn4eX9J97tI9jiEJfDCS/egU9eDrs9DH0yxhj0W270Li9PsiGd1f8C5y/pwshskAYNIEPhhZrsGPpS3irR4zYcDiLK2D3e8LC7rwOEs7L3YUIiWztA4rWT2XbAQ+dPRmLLkGP5b0jnC3/SU8mcAHI9t5TFBN6OORoiLEQh9DW3u5vp++tVG0C/9lCp+XWdN1BpgsgQ+2JMfgx9ICEP2EwbnKNn5gidsWqvjkR5Z4XpiX2rKyqm1lnFDcB84FPtiCPzIMYi/t2vO8rGrbmPEkcd8W+GBsu7HVy73fV4U+HiEG2I2BMZw9Zp+mJYuuH4IfpPTO6ANTFFUJAh9sy3FmlW1LXOTd162SH1hiNxgVn/ClHduCbd0SgzY5dVq6VNzJFvULeFkECnP5HAm81O2Nx4rgVq7b2DI/+w/5vQl9PM5K8pcR3HRtYxL2ESL4YasXUhHUAiYnXlJVJbBtOVW2LbWyP7fwDXlZ6nmh4pPvWeqikG4fWxKLrs8X8WUzFNd/48825RQ4XWroo4hub0v+/jyCzlAk8uK+76tCHw8UCUAVkYzBC/XTnNpmg0SuDDwwQaoSSCWXLUaWXM25yrCtNKSm4hM+te+c2Bqhs0TiN/5ykV+e1PYFTpPT7Y3HONMZikRe3mceR+jj4XRiYAwXXdtYOH6C2BbHwzIpOHeBSYnJJS+ppLIv7JzcTlS2LbWrA3yLik/4lPv1yOJerLgwHUF4UrrXAh6j6sM31vu4lwgK/mq0SOiHzy1CHw9QVvWpCXJGsPYiPYzY5kW3D7bptmubt0YcmIpYzFLNRmovLawmt2uhg69Y+sKDik/41Av369GZD0wkgvC7i/zy5ETgIL1fy6o+WvogcC/OV1Lbj5zCNwl93FMkr3URYAxn0aWCYZikY5vcF4CpschLLvwW03vxowkDFsfe1Co+4XPuE+M6mfOXy1WEmfy2ycHzsqpdB9I7F3Lke+I81RCAHJx9r2ur0Mf9rUyAMIKbrm1MKA1L6INtuY3uMgCTEK0onztaZOJ5/CZJ63dtpeELKj7hXye2AxtHLCDpNJHGmXl+MqKgLD3bX/JN8buwhkcudr4XXBX6uIeYjLS/ImOQKh9Y1zZXs/pC5Mz5C0yNySRy4zeZBxOc8CUVn/C3fmJZCGocqvsTiGu7eX5ysqvbRxb2LezzDUeCgmTm9FtzOEIf9+NizxguBBRGczvT70U+rru20VUGmIyo5Nflg9w8t6iahV3d8uALKj7hX0KaA/NsnpTFdXKksCwPxwI4fIXnIHLzzW4fQh8/EHsc26uJoa09zI3q3Yy/G3nwAgBMjecOcmUCJQ99AMexgE+p+IS/7dqSbXCezROIIJ+xJ0f7rrPZWNn+kjux5aOt2MjRV9enhD6+Ix4ETXwxhrOubd4bWZikV13bCBYBkxHPtNpyk6sjlfTZeGmyGb6g4hP+Zn50ILYXSUqLfnLmeSMPO7HNn3dUCuclGduNUNInhD6+b+VBkBHcdG2jWmhc0riM5Va1HzBBJjfJ2Y5QUlZsZwFfUvEJtmQbkgWkdDxzkjNh+Hzo9sZdSPOFkSBjQh/3FRVOUteMQRvBEcXDsYUtxnKqSw8wQSY3yZ3faD765+irpQ8CfEbFJ/xNt49hmBdMwOIdEyAMn5e+25vr9bI5H8ndFxmGnx2yb5LkYwyvu7YxiTouLakZy5uubS6NLjAlsUA1xcnNm6Io3n+2+OwZ6uvunn2eRbezZ1GZNCUv+t+qYGU2+j3FV13bmOSEf91VfKrQZ8mO3K+fJraLUqiUxlTnC6/jveht/Pd38cennm10ft6Lv4MJnm/9IvN5Bp+Dv/1eVvVV1zZvjcciTTH0cbtxn7i7V7yN+wifups/Kzb+8/OpjVG/xcvmmpXQx1dEgm9qE6Xkb60qYiskMBnDWjUOMFFTuC+uI9Dx8c+EyoN9NQwTnQsPYoJ7CsGf/nMuJVx589mkS44TC7/GBKfAK9ty+9kiVo4LNX3F51vbtbJF15/9U6nvFzsRfHIOPF4O8wq5/a62ZQrvRbfxPNw/3/f3G+GOh/niuTWKIO7eiY4msOaztGLGzetRrsUL/faXBwKPyxLXjincH2/u7huKzR/sW3Npe3EtvvvbTfDZHuJo8/4n9PGZOKAW5hmDbSFGFjdjoQ/GsPKyDUxUzpNG/QTPedc2KplGEC/8/d9q4xnpJOOJi6OFhD5uurY52Pwf+knEOFa5LXCfxwSnZyDGdtu1zd7mvxHXrasMJ/9VfLItv3z+jBRdIv5IfAROhT4eJwK5qa9p/+/z61dZ1ecL2eI85xD0Rcw7ubcMLObi796LzmLt5ySuZTl2AdnprxULWbz97fMgbSb3uc/tRvcVaw7LkvNc2m08i116Vx9ejOn5XdeleH47yfhZ6ZPf6v+k+xzZWmmzxwiuLWhsRa4P7ExbPwktDAhMVY4vqn0lwv92bXPo+Wg7+snOfqz7Me/HPo5BbpZS1fbFpExM8Of4/XcW1H2FtL52XryPybV1hsfmMkIpMKavnRfnGdzDd/s20ok/w1Sl3h7q4huhgtkvGMWCTY76sMf/17XNicDHdvSLeTHH14c/XmX6nLGU96IvfvNxn3ud5uN8V78dqbnhZcnxWWcdoeC9PjAl8LEdfQivv0/3jxP99v8ZfsTdCDR+JPSxIR4Ap7jnOfmzLcTI4sL2ctZfklTs2w1MUtwbc2tD+KrvcqDtZDrxwnoQk5w5+eRFdca+OqEfE/2/Zfi196MCGLYuzoscn8V37bdPQjl02TDH9UDxjJO6QnTJHVpyW0RfRwj+RFfoNCIUfxZbv+QWiF/aFi+f6NrmNNMihZcZB8gY3kFmY9qHDfYUTqUTocE+DPSfDAOD/1ybhD4+5YRhDK+ltbfC+csY3liYBCYspwmJu4oE1TGZiGPxS2YfK7eJla2K9sY5Vo4cR6tl2LqubS5VfMK/YrL/NvGQPI+tybi/1EGZ64XPTeb0XnQTC3fmmjIQi3gH0XUlF7lux7lNR7q9kUoc45y2mOw7dR0JCeYh3k8PM7tGCX18Ll7Wc6uEZPr6E99E0MiitagHYoa2VsEETFxOk/GnKhLyE8ckp+CHBaS/uxqkXsz7mpUFPlJR8QlfyOGZyrvyPcXiUerw5NLnJnN5hunvZYcW7vITrfuzCX4s/bk7tq3IMXRu+8tlyOn8u4jrExnZ2KI3l+DHP79ZoY9/W+x5WWEMpx7kxxUvz0tuUcl47I0HTF0uL6qvBD7yFccml61eFr94Gu8OOe4f3E9wnqtsIyEVn/CvVQbnw7Hf/r0dxX00ldsld5WIef+U43+nP2dt55K3nEKmiw9bRzV9bluSFtHtaulBurnLZV7iWuAjXxH8yGXu5p/ONEIff1tl8vDHvFxb4NiKU116GMGNLQiAGchhouja9TR/cYxymODcy+AzJBeTB7ltvVPERIKwNUmo+IR/xaKxbh/TkfpZeOnP4rk8X57Z/jtvcW3N5VnDe9G/76nXGXyUz72MzuPMUw7n3zrTdx82RKg2i61I7zpELT70Ea04X2TwUZgfL78ji7T+y1l/SVJx/gKTFpWXOYSalz7JPCU53PsEeUOEx3PaW/xOX9lt8okkVHzCJ3II4bkf/EDMO6d8vlkrSMuiYrvvtiI4OwERzMnhGXzxHRA35Nrt7TzWJpifHI6rDuTTcZbJNerj73bxoY9MkvHMz2vp7a1w/jKGiyW3PgVmI5cuH66nExHHKnkVVSyO8LecWkxv+mPp+4yTjopP+FssBKRemNwVBPyh1KFaQYOiyGEbIsHAacnheNk+K2S+/aVub/P0PPG3Wrt/T0dco3I4Xjp9RCWGajKGtvYwP76YUEt9A2Z+1rp8ADORRWVCBp+Bh8khUGuCM2y0mM6xsu0yOgpBCio+IX5zGYyD0Mc3xPUgZXdpi0Z/Sx1U1W1lYiJU9ybxp96f3MCNKAoUfsvwo+2XVe06y9AuYy6A6cjhOrDsTh/x4G1hjzGcuiiPKyaYPVAxhjPnLzATqRed1tGGnwmJCenUC6k6SGyI7oE5vrfu6rpHKio+4W+ZdOl6rkvXN6UuCLNo9LfUIVXPS9OU/H4uYP2p2CIpdRjna37V7W0+Mnmmse41MfG8lfr6tPjtXVaZ7HPOvFxLb2/FqS49jODGHqvAjKSeILLoNV225MlMvF+8zvCjvSirWiEFSaj4hH/k8HvT7eMzsVibehFQF+K/pe6Y4L1omnI4bsLwX+rvN7e5fajo9uZ4MYTbKPxgelLfNz7OAy8y9BFprZTt9Zgvk54jiy49L2f9JUnF+QvMSeoJB8GB6Ur9omqy7Cu6tumfU26y+2BF8bsJTlJR8Qkfz4PLDBbAjm1t9IWTxMWGb2KLChKLkCITE1XbqTsp8ZnMu72d684yC+bSeKzUx+5jyHWpnT50YmAMr6XwtsL5yxguvIgDDMo1dbpSP8+aKPu2owy23/maKxOcJKTiE/Lo6KDbx6dSF5XoOPR34Vjq67DQwLSlfqcVpvuKWH/5JbsP9veCq2vv9KV+r7W+OFERtk3+Xrq40EdZ1We2hWAEa20TxxfVUs/n/j3ZurUuH8AMpXxRXassnC4h5nzFeZXjotqO1uWkouITPrrMIBTonTrE3FXKuedrRS3/sHjHU6Q+fkIf3xDbX15k+NH6zldCkDyF+8a0JT1+/bvnokIf0WrQSwhjOI3JJkYSk2XSsozhzPkLzFDKvau9pE5fyqpElfHfEW38X2X40Z5HgQVsnYpPli7eZ1P/1nYsdP0j9dyzDrn58F40bQoZ8pbr9pcr3d4mLemxE9qcvNT3/YOldfpYJd5PkXm6jnQp4zrVpYcRXMde4AAMx+Tm9KUMQ3pf+4Gubc4ybRf+sqzqwww+Bwuk4hOyCBgtvtAuCg5Tdqi9NUeZFaGBCdMBMW8ReDzJcPtL3d6mLWnX3DkM4MIlv+8vJvQRk08vMvgozM/iX2rHFi/NL+f9LUnE+QswPN2Tps8EZ/6OMp0UujTBSUIqPlmsWPxKHXzaF/5LvvWzopZPpf49Cn1MX8rnbc8OPxDBnBzndvd1XeIRzMNMn9DHFrnIMobXUr9b4fxlDM5fgHGY3ISRxeLeUYbj3Fe2aUlLEio+IXngoFhyYUWc48cJP8La/FleurbxXjR9KecNPTfcQ3Q3ep3hR3tRVrViQ1gWoT9sE70AACAASURBVI9tiL2FbQvB0NaZvFDPWlnVR4lbYzJPzl9gtjJYVDK5OX0W7Scg9vv9LcNP2ld6qzQmCRWfLFksML9JPAQvolvrEqW+9qwi/AawKF3b5Nrt7Xfd3ngA8zATl0PYc/ahj3jRkKhjDKdepsYVi1YmjBmD8xeYM5MKsBBd26wyWOD7ml8jvA1bp+KThcthDmWpv/OTxP++YFleclyA5uEUNEyH7S+BpTtcQqePVbTShCFdx0QS4zrVpYcROH8BgDnpF5luM/w+5wuu9iYxFZ8sVXSBSv3bP1naAldZ1SeJ568ubCWSHYVG8+C8moi4BqYO333NrlAesC2zDn2UVX3YV1Jk8FGYH9U5I4sJ4pez/pKk4vwFGJeJMdii6F6WY1eNvvjiMoPPwXKp+GSpUnf72Mn0vjSm1AuNtq8FFq9rm/7d41WG49B3e3OdhmVI+v45904fEnSM4XXsE8y4nL+MwfkLMDJVhrB98XzzS4ZDv19Wted6klDxyVJFZ8vUHaAWs7gV3XueJ/wI156/Af7WtU1//7nOcDheRpE6MG9J155mG/qI5JxtIRjaWnp+fLH/d8oXZubp1vkLAMxVLPJdZPj1jqPtPWydik8WLHW3j90FLW6l7ibqWgLwKd3emCIBTp5slqGP2BZC+37GcBrtkxlJPPiknpxgnpy/AHA/7pfT1b8H32T46VdRCQ1bp+KThTrPYMFr9mGEmIM+TvgRbru2uUr47wNkx/aXTJTQB082104fq7iAwpCuo3qOcZ3q0sMIrqPKDwD4AVuhTVdMcJ5kWNnWv5+fq2wjIRWfLErcD1LPYT2PUMScpe5kpcsHwFdEIO63DMfmuW5vwFh+ntvIRpXEiww+CvOje8zIYjLg5ay/JKloKU6u/iqr2sEBYDB9aKes6v7d5Y/MRnU/CjQ8l7F1/QJ4bCP6V2ajf1fxqeMHY+ivub8mHtmzmV/3U84V3ipOA/i2rm1Wma4X9t3e3ipQBIY2x04fHnYZw2sVj1vh/GUMr7q20R4NAFiMWAR6neH3PY5ACmydik+WJt6DLxJ/7aO5drMpq/okcadpc2gAP9Zfq28zHKfzBXTDArZsVqGPeEm2LQRDW2uXOL6ouno+9+/J1t1GdRMAwKJ0bdOHK24y/M6/l1V9kMHnYIH6is+iKN5k+M1fxjsxDC31+/DOjDt9pAwxrs11APxYbHeW4zPWXbc3gMHMJvQRqTgVQ4zhNB4OGElUfXhZZQzOXwBgyY5iYSg3l3Ot/GYSVHyyGNG19jrx953dfG1sF7Cf8CNcmusAuJ+4F+bY7W2/rGprIsBg5tTpY5W4pR7zdG1/zK041aWHEVzbGxEAWLJo7Z9jhfWutvSkouKTBUrdvXZ3hp1sUt9bdSQGeIDo9pZ6y7Ov+TW2CwN4slmEPiJd/SKDj8L86B4zsqhkejnrL0kK6xm3kAUAuLcIwb7KcMRelFXtfYskouLzlwxHX8Ung+va5iqD7jazud7HPNZxwo9wEaFOAB4m1+0vV7a/BIYwl04fKoQYw+uYCGJczl/GsDIJAgDwt65tzjJo7/81v0cRB2xddPVU8clSpO4M8XxGC1qpAyzm0QAeIbq9nWS4/eVObPNn+0vgSSYf+iir+sy2EIxgrVXi+KK95/O5f0+27jYWNgAA+NdRhhOcvUsTnCSk4pNFiJBT6nvA5Lt9xP0qZSjrOjq3APAIUeSb4/1ov3/+y+BzABM26dBHtNPTDpYxnEbyk5HEi7IHGcagKg4A4DPxfnOU4bj0lW2XGXwOFkjFJwuTeg7meAa/6aM4P1MxjwbwRBl3ezvW7Q14iql3+lglftBmnq7jxs+4TnXpYQRvVL0AAHxdPCf9luHwPI8unrB1Kj5ZkJVuH0+W8l7VdzUVkgQYQNc2J7q9AXMz2dBH7Pv7IoOPwvzoHjOy6NLzctZfkhTWzl8AgO/r2qZf9HuT4TC9jPd82Loo/Hid4cir+GQw0dkmdWhgsr/nuEelLF4SjgQYVo7bX+7Y/hJ4rCl3+tCJgTG8jiofxuX8ZQyrrm3eGVkAgB/qF91uMxymywiIw9Z1bXOq4pMFSB0c2J1wkCllkcnaVmgAw4p55BzvSbvWT4DHmGToI9q+2haCoa2l5sdXVnWfoH0+9+/J1vVtTp2/AAD3ENXeRxmO1Y5FLRJT8cmsxQJX6m5Pkwt9RCAxZcfpVdy7ARhQbJuVY7e3F2VV62gNPMjkQh/xkO1ixxhOvUCNKyap7EnMGLQ8BgB4gOhw+EuGY7ZfVrV3BpJQ8clCpL7GPp/gdl6pi0zcFwFGEt3erjMc3991ewMeYoqdPlZR5QBDuo49fBnXqS49jOBN1zZXBhYA4GHiHegiw2H7NToEwtZFxeerDEdexSeDiPfn1ItbkynciAKmlPekC0VqAKPLsdtbodsb8BCTCn1ECjxlKz3my8TJyKJLz8tZf0lSWOvyAQDwJP270E2GQ3ge7xCwdbF1pIpP5ix14dPxhK7xJ4kLEG1lCzCyjLe/3LX9JXBfU+v0oRMDY3gdrY0Zl/OXMZypeAEAeLx4ljrJsLJtR2Ubian4ZLai09Nt4u83lQKOlIVi17HtFAAji05YOXZ767dFEwAEfmgyoY+4qNkWgqGtJebHF62Zn8/9e7J1N13b2NcWAOCJIgSfY/fD/djiFbZOxScLkHo+LPuuuzGflXI+2pwlwBZFt7c3GY75y9gJAeCbJhH6iHZ/tt9gDKe6BIwrKpBM1DIG9wUAgIFE1ffrDMez3wLAdn4kERWfv2U4+io+GcJl4m42OxO4vqecd7iJaxAA23WSQTesr9HtDfiuqXT6WCXeO5F5uo6JTcZ1qksPI7gw+QEAMKyubfpn95sMh3VVVvVBBp+DBYrugio+mZ0ogkpdpJNtMUcUIabsWquACiCBjLu97ej2BnxP9qGPeIF9kcFHYX50CRhZvCC/nPWXJIW18xcAYDRHiSu/v6af4DxX2UZCKj6Zq9TFUPsZh5dSdtO5VagGkE5sf5lrtzehQOCrptDpwwMuY3gdN27G5fxlDGe2ZQIAGEfXNu9igTs3+6qeSUXFJ3MV1/yLxF8vu6KOCFMdJ/wI7ncAiUW3t9T3yK/5tazqHJ9LgcSyDn3E/qS2hWBo68Rp/UWIB4+UbTCZp5t44AYAYCRd2/SLyK8zHN/jsqp1fCMJFZ/MWOo5shfRKTYnKe81a0VUANnIdfvL8wzvnUBi2YY+4oJlMocxnOoSMK6oiDDpxBhyrDoFAJidrm369/HrDL/X72VVH2TwOVggFZ/MUXT7SH29z20OOOXcw7l5S4A8xPX4JNPtL3V7Az6Rc6ePVVy4YEjX9sTcilNdehiBbZkAALbrKMMJzt5lBM0hBRWfzFHqbh8nuVzXy6o+STynpYgKICMxH51jgfq+bm/ApixDH2VVH/at/TL4KMyP7jEji0mml7P+kqRgWyYAgC2LyrYcuwfsan1PKio+maOuba6KorhN+NV2MrrfpOzycRGdVwDISBQS59rtTWds4KOfMx0GkzeMQZeA7XD+MgbbMjFX/QujSb3t6wOKx0v70gCP0S8EllX9KsNg94uyqk9juw3Yqn5uof/9FUXxR2Yj/7HiM7Zngoc6S/ybPks9pxTbhz1P+BHc0wAy1bXNSdwn9jP7hKuyqt9a+wKyC32UVX1mWwhGoEvAFsQewilfjpkn2zIxZ+dRVccWRVc5oQ+Ae+ra5iwmOHPryPl7THC6l7J1/TtKps8Uv8Z54R2KB4nfdMp52d3+nEp8TU8ZmLq2YAeQvX794210qMrFTmzzd6hoEpYtq+1dYlsI1QiMQZeAkcXeqyoSGIP7AgBAeieJW/9/y2W8i8DW9RWfRVHcZDjyqwhqwUOlDgslK9iKeemUIS5zagCZiy24ctxOZd99BMgq9BEXpZwScsyDLgHbcapLDyOwLRMAbFlUrsMnIkR/lOGo9HMIlxl8DpbrKLqL5uSu4lMgiodaJf49P4/wRQopF/Fuu7ZxLwOYgLhev87wkx6XVZ1jIAXYkmxCHzGxmFurWOZBl4CRxQt5bnt8M322ZQIAyEiEcX/L8Jg8jy0JYOtUfDInEfBLHT5IdT1POX/oHgYwIV3b9PeM6ww/sW5v0+W48WQ5dfrQiYEx6BKwHc5fxmBbJgCAzHRt0y8iX2R4XF6WVZ1jJxIWQMUnM5M6gHC07S41cZ6k6j691qEYYJJy7fZm+8tpcszmIelxzCL0ERU5toVgaLoEbEFMrD6f/Rdl22zLBDBRqkpgEfrKtpsMv+h5wm0BWDgVn8xFdK9JGe7bSdA9J2WXDx15ACYo4+0vdxXpQjL7Kf/x5KGPmJCx/QZj0CVgZJEY9XLKGFSjAUyX6gSYuXjPOsm1si2Dz8FyqfhkLlIvFm1trji2HE85QW9eDWCiura5KoriVYaf/kVZ1dZdYWFy6PSxStg+j/nSJWA7dOlhDK+isgiAxxF6BUYX22jmOJG4X1a1BTSSUPHJXMQiVsrONbtb3LIrZdHJhYK12dJ5bB4Olz4A/FjXNv0ayZsMh+p33d5gUd4lDX1EkvqF3xwjkGIcWTww/DrrL0kKt6pcAJ4mFmLhKUxScy8RtE+5BcC3/LrFxUL4hIpPZiT1u/nov9foQH089r/zHbalni9FcrAsJzGvnRvd3qbDceKp0oY+VBkwktcWO7bCwjxjsC0TwPSpJJk+oQ/urWubfoLzJsMRO1fZRioqPpmDrm0uEy9gPd/C7zVlEOqNLqcA85B5tzfbX06DZ/SJi0YXSSULfZRVbVsIxrCWkh9fWdX9xO7zuX9Ptu46JpUAmDbVCbA8R/EulpOdCH64JpFKrhWfV84LHiD1HNtooYw4D1Ju7aKYanxJi4qE7GYh5fy3UNjERCHybxl+6uexHgvMXJLQR7TO01KSMegSMLJ4KfZiyhhSTrYAMBxdIqbP3tU8SFQq5/gst+/dhVQyrvjcUfHJA1wmDvUdjxhSOorzIYXr2AqKcaXuBC1gx1MIfUxQ1zarTLe/fJlDFwK+S5H19CUPe/6c6N9dJXyoZr6uY09pxmd/bIb2XltTgNkQ+pi+lBPUOVbFcw99x7ayql8XRfFrZuPVLxheeVckhb7is6zqvuLz98wOwMeKz9iGBr6pDy+VVd3P475MOEqnI3UcSfn7d09ahn6BVbhnoiyQ8wSnsfi7n9kg9u9re4qmv+tdyvBFH3R1fCYtedhz66GPuFm+2Pa/yyLoHrMFcdPxwgIAebtO+KKqOmH6Uk5OCYFOWNc2p9HKPLfrwKqs6rfRchm2qq/4jPPiOLORfxmBKO/3/Ejq0MfJ0AGNmJ9Ote34rSDiYgjDT5vjx6NEYPIk1lByKn7fic9k66lvSz0fcWDtbdKShgX797oU27t4qGUMr03gAQDkwf7V06WijQEcJd4K4Gv6Cc7zEbcIgB/pi1RuMhylS+cFPxLFPylb1e/G4tmQUhaO2XZse3JYvGO6Uh8/ax0TFmtVORYp70cHL/JkPmbakt/3txr66FtHJkxRM1/rxC0ZAQD4lBfV6Up97HT6mLhYHMxxO8h9RSikEufFSaaBKNWE3EfqebfBQh99a/uEXajX7kXbk8E2wvuCdZOW+nnWFg8TF12dUoYmv+XXsqpt3/91woI8ShS/Je/ss7XQRzxQ236DMZza5woA4BOpF3CEPqYr9eSP0McMxHYRrzL8Ji/KqjYvQRIqPpmyWDy/TvgVng/YjSxlgGVlDnNxLKxOUKxlKV7mybq2Ocm029t5/M75VOr5iFShVJ4u9Tzox+f0bXb6WGW2fxXzcG0fTACA7LxQ1TY9Memzn/iDWwiZia5t+kW1Nxl+m99tQUUqKj6ZuMl3+4jn05S/dXOY25cyrFQIfUxW8uMWIWrmIdftLy8z+By5ST4f4Zl8sobeivBRthL6iCS2hBJjUKUFAPClHPb/9aI6PTm8pNq7el7639Rtht/oUjCNVFR8MlWxAJnyt3s8wG/0JGFR4kUG242wfcLw02TNgcHEtT+LBeHP9N3ehBE3RGe+1HL8rfAdUVSSuoDq4293W50+XDgYw+tMLsIAALnJoVtC6mpQHi6HyQWdPmYkWtjnGADbNU9BYio+marUWwE99Vkl5UKubZTSyKFbggDBhEQBc+qtXVJ3qGFgXdv0z1ivMxzXPlApZPCp1M/oLwSxJyeH+/zHubTRQx9lVZ/Z/4wRrC0kAAB8XSatYHdNHkxHWdWnOby3CXXPTxzT3zL8Yi9ivgK2TsUnUxVbFKXs4PToSfVol57qWefaM04yOQSKT3X7mJQcng91BZqhrm1OM+32trL95SdyuF8Lik5EBHSOM/i0H+eBRw19xJeVZGUMp1E1BgDA1+WwpcLKBGf+4hjlMLmZ4wQYA+japp+0ushwLF9GNSdsnYpPJizlQsTOE36fKeeohQzTyWHxbkeHsWmIIPzzDD6s0Md8HWba7e3c3M0/crhvvPCeOhm53N8/3jfG7vSxSrhPIvN1HZUFAAB8mwlO7usyk/c2k5vzlmtl26UJTlKJis8cW7ir+OR7zhMvWD04vBGFiakWcm8z6cK3SBmN/QuBurzFfS+XgJZrxkxlvP3lvu4S/8ilM5f31MxlFBS86yQ5XugjUkgvxvr/z6LpHgMA8GO5vKi+0Co+X3FssnhJzeg3ywhigvMk08q2yww+B8t1pOKTKYnrecpnu/1HVL+mXMjV5SO9HDogFgJ1+Yr7XS5B+EIYft4ijPYqwy+p29vfcjn/+uvRlefxPMW58nsmH+6fIoIxO32Y2GUMr+2BCQBwLzlVBx0LfuQnjkkOe4/eUdE2c/Eul2OI/3lZ1RblSELFJxOV+rdx73tJLJaket651a04C7k8Y94t4OV4zV+sCOL0v5HdTMbg9q5im/nq2uYs025vfyw9nJZZd659wY/8RODjj4w+2D9r5qOEPmKyJJebJPOxlo4HALi33IKyffDjbbTXJqF+Eqc/FpkFPnKbXGEksfh1keH4vrQIQyoqPpmaWJBMeS1/8YBnypRhQ4GPPOT0XtQHP/7s108s4qUXrfmvYmE1Fwpel+Moo05Em2wrklcgp78+vfOuml5/XkTxVE6Bj2Iz3Dp46CMeuG2/wRhOowIGAIAfiOemm8zGqX9Z7UxyptG/q8UL6n8zm9gsMvytMqKubU4yPebngmmkEhWfbzI8AIuv+OSbptLtI1Vwaa1bTjZyDBa/7Bf3BevS6LeIKqv6Klrz57Klyx1B+IXIuNvbrtBidufhXWDw6hFb3DGAuF+/y614KowX+oiH2dxulEzftXaIAAAPluuEUT/J+X99AEG1wvj6MY6wR5fpC2oRe2izLEexIJaTnahs+yT4EVWgsA0nmVZ8nn8+wWyhktiyK2Ul7MmPQsTxO03VjfpS8Voe4rea47V1N4J1fQX3SsBuXBGAP42Oh3/12/tl+lGFPhYkrk+/ZfiNX8R8zT/32fjPSwkc5Hoe9tetvyL88cPnIJ4muuT29+f30d0jx+zDzebz5s9D/n+OF8AXQ/7/hGCSDQDg4fqF9F8zHrfjaB1fxKLBVfy9s4/x48Rkcb9gfRATMrlOZn5O6GNh+nM8FuP+zOyb33UkyuCjsDT9hF2EIf+b2VffjwnmDD4KmVklfNbYiQDh94rEUoaTbFGdl6uMw8+78c72a1nVt/FZ3979CQ89TqxVbb4X5dbp8GtuIwTAgnRts8p0bXVzvmZR+q0Xy6peZ9zg4Hn89cHBm837hmvI40SA5mDjnnE4kQYXnwSUBg19aPnDSF67UAEAPNwEXlQ33b209l1AiphYuI32iXdUPX1qs8pmL2El61OtPe8vU9c2fVeN15mH02Cr+uthWdW/Rct5yFpcx28TPoP0C2VfXeCIYGGqQMqFAHN2LjMOfWzavVtovfvf4r2oX9S7C3+8++wdaenuFuruTCX0/jWC8Mt1EvMdUwgnLcVU7hv7m7+buGesIwRy5+3GPYS/7xl3XVKeTfy8+ySXMVjoo9+Xe8KTjORrLRkPAPAkU3lR/Zrdz94xpjyBx7eZ3Fywrm1Oo0ON8xtCVHweTPj+zbKcRcvrFPpg83/Lqv58m5nUYViFkZmJgNJUwvBfs7kg5Zlpvlw7Fiq6vd0FP6Z6nZqbKc+l7Xx2r3DfmKcvukP9zxBfM/a7tf0GYzjVwg4A4EksqJM7k5scReAf+NdpVHZD1rq2Oc/gGv78s7+UgY/rvttewn+fb/NeRM5s7bJwcfyts2aiDwt6RyVzXzzXDBL6iP0bpc8Y2nW8OAIA8Ejxonpr/MjUrYURIuh/tPiBgA1xXpyYbGYiVg7UP8xl5suxIWd+n9wFKS+MRDaEBcnZF8/fTw59lFXd7yP9wmFnBFKNAADDMIFErvw2+SjCP6+MBvxLxScTshJQ+uhWAVu+4llDGJ5cuXZwR7e3fAi1kqu+acK7zz/bEJ0+3IwYw2vtzAAABuNFlRyt/TbZ1LXNWVEUbwwK/EvFJ1MQnWlUwxbFWQafge9zjMjRm68t3rFMG10QhSkTizXK60UPArn6ajbjSaGPsqrPEu+RyDzdegAHABhOTBpYMCI3l/HbhE0nqnDhCyo+mYKlz+WtBV/yF0E6C6nkRhCeT0QI6MSoZGHpzzfk55ud5R4d+iirek+LSUZyavIXAGBwXlTJjd8kX9iobAOCik+mIBaoltytaWU+czI8g5KT69h6CD7RtU0fJHxtVNKK81O3D3LyzeeYp3T66NOHOw4zA7uImxkAAAOKifhXxpRMvNLCmG+JNrq/GSD4l4pPJmLJ1eoq9Seia5uVrmJkRGE139S1jW5veRAWJBc33+ryUTw29FFW9WFRFC8cYgZ26yEHAGBUK1XCZGBtYYQfiQWZJVeMwxdUfJK7BVfDXujyMTnmoMnB6wg7w/ccmsdJK55vvJuSg+8+vzy208c3UyTwBEdekAAAxhPPWqqESe3Ecz/3dKKyrdDum0+o+GQClhjsVAE8MRGis4BHSmvXDu7D9pfZOBG+IbGLH20H9uDQR1nV/Y1o15FlYL9ItQIAjM8EJ4m9sZ0j97URVDO5Bp9S8Um24j6/pK0zLmxZN1meMUhJEJ57i4Ve2/UmFOerLlGksr7P7+9BoY+yqvf8qBnBxff2IAIAYHAn9rEmgVudZnioKA4wDwEbVHzqgDMBS6peV6k/UbogktBrQXgeqmubs4VuoVbkMn8V65gXGXwUludeO2U8tNNH355vx4+JAfWBDw/XAABbtLFYpLKNbVnbzpHHWvjkmupxvkrFJzmL6/YSAsa6fExcLLy7lrJNN7FVGzzG0UILeHK619pqkW377Ufbutz5+b4frKzqvnXkC4eSAd2o2Jq2uC7sxd9BURTP4gsdCIhl5ToejPobw5UJCQCKqJ4vq7p/FvvDgLAFp7Zz5IlO4z1jf0kD6dmd7+krPuO9/PnCBsp5MQ19kddfM/+OunzMQFxL+7nN46WPBaO7jS3a4FH6Ioqyqvvgx38XNoLZFI/EMTiM51FrYIytDxiv7vtvPKTTh+03GFIf+DhU6Tcd/ctPWdUnZVWfl1XdLxJ9iJf3fqHoZYTCnsefm11enseLa3+surKqL8uqPlj6oADwTxXmL4aCkf1iO0eeaqEdilSQcR+Lq/gUhpqGqEiccxv6136L8xGdqN8sfRwYlc6HDCKKKX5b2GhmVUAS5/Gh7rmM7ME7Zdwr9FFWdZ9a3nX0GIjAx0T0wYCyqld9yKO/l0Vo4Hhp1XUz1Ad0/hvH9tnivj0AnxD8YGQCHwwmFteWtD2oxUR+aCMQtRRL3ct+quba4Xety8csnSx4OznGtY71EJ0PGURU/i8pqJbduRPns+AHY3lw4KO4T+gjWpvZgoOhXAt85K0PAfSt3iPo0bcJ+1XIY7b6Y3ul6wcAG8EPL6sMSeCDwcXe+68XMrL32rcXFlbxacFsQuK3+WqGX+3U3Ob89Mc0FlgEPxhSXwB7IPDBCE4W1Bkwy/eijeCHDo0M6VGBj+KenT7ObdXAQPofqsBHpmL7lv58/7+iKH4X9FiMfcEPAIp/gx+HS2sRzyj68ND/E/hgLF3bnC5kYk3og3uLis8lLFQ6L6ZnNbPny2vPOPMWCy1L2zqBcbyJAljd2xhcrLOdLKB45ybnNcWN4IdudAzht8cGPoofhT7Kqu7bQz53mBjAk36ojGcj7NHF1i0sz04EP/Yce4Bli5fVA/tZ8wT9RMeeSja2YO6tdG+dRzzC3ANR6+j2w4TMbAui9cK2U1qsCNL9r0A8T9CvhxwpgGVM8b4w950asg9aRqeow5l2N2M7bqN4avWUf+2boY9+i4dIYsNT9C9D//vUHyrDi21chD240wc/TJ4BcPey2k9m/8d2LzzAOiY2dfZjK+J3Nufgh3doHmxjcX2u54V31oma0RZEFnAXpGubqwjEL2VbOYZxM8TCHdxXdJ+a83VqMs9/Xduc9ee/7V54oNdDbQP2vU4ffTps15HhCe6q/LTezExZ1f35/U7Yg8/sl1V9ZlAAKP5+We1frPfsac09XMRzv4lNtmrGlW3rKVS0kadoIX8408PjfXXCZrAF0S/mOJcnAvGn0fVD636+Zx3XiUEW7uAh4jo1x7mbi6ltj9Sf//11IMKuCqn4nutomnA6VKj4q6GPaPH/0qHgkVT5ZSq2culfUH+Pzg7wudPo9AQAd5Oc/RZ9pfAHX9H/Jsr+N+K5n1Sisu2XmR2AM+cUTxGLTXM7L15PbdKfL8Vz5RSfKS/ifsNC9YGfaN3/iy1f+Mw6tnTYc50gsblt87eecuA3wq57cX0Q/mBT/xzxn1hDHzRQ/K1OH25OPNZ1tKFR5ZeZsqr7F+t+4uf50seC79pZwD6AADxQv8jyWfjDC+tyrT8Le1iAI7mZBT+uvU8zhJmdFze6fMzHBIMfr+Mzw8dra9c2e7EVps4fy3Yblfx92ENgl+Q2uPndpgAADKZJREFUtr+cS/DjdOrzDVFIdRbhj9+EBhfvrrPHXnRXHtwXoY+yqo8sCvMIt/FjPTTxm5e+a0NZ1f1kzx+6e3BPJjMA+KqN8MdeLCTZp3Q5buKY7wl7kKOZLHD359lRBp+DmYjz4j8TD2v2n11HqZmJ58lXmX+ru60aFMbwhX6xJjp/lLEXv4W8ZbgLwN8t2q3cn8jJRvDjzcQPzKw6bEX4Y7URGtRJdzlu4zmhHKOzx+d+3vzv0dJfRQkPcRutZ3WHyVCc0/1FZH/pY8GD7JZVbf9J2A7n2fLMYjIwJhL657/z2BryKCYWXmTw8RhOX4XQVx9czjDksRaInp/+vbSs6ndxfdqd2BfsAx+pt0i9TlQEZLFkRP3CZFnVh3FeTG1u4GMQaqFBw9mfF33la2xBnOM1+zoqjJfwvuad9Ani+nQa2yUfRCHVobnYWVlvvBONUpkNQ4r3iaOyqvsOEy8nOLivojvGLMV1pH8+P437xVH8mZ+Yj5tYlz3f9rPkz5/999MJToyQhrBH5uJF49I5zSMdevFnQd4kWqi+VRGSRp+qLqs61YLvqInuFGKic3UXHo+Fpbs/HQSn5Tp+o1djVx9koH9OPk7wMTxfjSyu8QexFcSvE/jI/f1olcnEZqrtQOd+vUmun2yM+/Np/E1hUvlVnBupn5cvE5wX66UUYcTzxl5sSXyWwRzWEuc7U/3W5vhe9PZuy+QIxt+9Ex0IgUzKbZwXd+9Fc74ev00Uhl8v4H0zuQhXXsZczRTmZm4icLmI30Y8417G39163uZ9w7redNyFPN7GfSNZYP2nDx8+fPwP8SDSTW4o2bY38dLtppyxuEFcSQfyBK+1MGUpEl4z/6NKJJ2YWP5jyx+gn0w5WFq1apxje/HS2v89EwZJ7joqiN/G37uldfiK99+3W77233Rtc7DFf2/x4jifxF9uk2Y3dx2TcgmBJuoUmUOHk0WJ43x3XuS2CHm7cV5k8byU6Lz4ZalFVrHt+LYrXm83qjEXOd9ZVvVqy0HJi9jiZ1EifLf5brRnUS+p9d27UPx9XLBb2jNJormRxd7nUonrz0mmHSXexD3YHOmGeAa9C4Lsbdw7rPmlcxNzaVd3947cnh03Qx9XJl/5huwmo/g2gQ8Gch17k8IixKLQaTw8j+3dkicUc7JR8fpsCx/rbVQNepbaEMeg2HiBLeJ4WBh/mrcbbeHvJjEL151Pbfnaf+l9Kq043pvhs21fZzaDVm9zDQDG5OJdq+GxXWXSyWGxPptMdl58w0ZQ5mjkf+q9Qqt/xfzW5gL5UM/sd89GWf/uti0WfrcRxDi32PupeEa5exfavP9u/u883PvPOtncvSO9t6X1p7Y4N+I+l4ER76/3dXcuLqHD6CjiGD77yvO79Zyn+Wf+LNz9PicTCPwY+ogU9Z8ZfB7ycLdP3VXsVWcCZiIEPhiQ0AcAAAAAAABk7udIq68cqMW63Whf9i71fkM8XqTCBT4YirAXAAAAAAAAZO7naP+ipdoybLZKeifcMR8R3roU+GBA2hwCAAAAAABA5n6Ohf8zBwomrQ9u7TuEDEjoAwAAAAAAADL3Pw4QTFtZ1X1o64XDyMCuDCgAAAAAAADk7acPHz44RDBRZVUfFEXxX8ePgb3p2ubIoAIAAAAAAEDedPqAiSqr+llRFJeOHyNYGVQAAAAAAADIn9AHTNdpURS7jh8D67t82NoFAAAAAAAAJkDoAyYotnV56dgxsHWEiQAAAAAAAIAJEPqAabL9BmNYdW3zzsgCAAAAAADANPz04cMHhwompKzqw6Io/nLMGNht1zZ7BhUAAAAAAACmQ6cPmJ5zx4wRnBhUAAAAAAAAmBahD5iQsqrPiqLYdcwY2Juuba4MKgAAAAAAAEyL0AdMRFnV/dYbp44XA1v7XQEAAAAAAMA0CX3AdKyKothxvBjYqmubdwYVAAAAAAAApuenDx8+OGyQubKqD4ui+MtxYmC3XdvsGVQAAAAAAACYJp0+YBrOHSdGcGJQAQAAAAAAYLqEPiBzZVWfFUWx6zgxsDdd21wZVAAAAAAAAJguoQ/IWFnV/dYbp44RA1v7XQEAAAAAAMD0CX1A3lZFUew4RgzsrGubdwYVAAAAAAAApu2nDx8+OISQobKqD4ui+MuxYWA3XdscGFQAAAAAAACYPp0+IF/njg0jsK0LAAAAAAAAzITQB2SorOqzoih2HRsGdtG1zZVBBQAAAAAAgHkQ+oDMlFW9pxsDI1j7XQEAAAAAAMC8CH1AfvptXXYcFwZ21rXNe4MKAAAAAAAA8/HThw8fHE7IRFnVR0VR/Ol4MLCbrm0ODCoAAAAAAADMi04fkImyqp8VRbFyPBiBbV0AAAAAAABghoQ+IB/9wvyu48HALrq2uTKoAAAAAAAAMD+2d4EMlFW9VxRF51gwsHVRFHtd27w3sAAAAAAAADA/On1AHs4dB0ZwJvABAAAAAAAA86XTByRWVvVRURR/Og4M7KZrmwODCgAAAAAAAPOl0wckVFb1s6IoVo4BIzg1qAAAAAAAADBvQh+QVr8wv+sYMLCLrm2uDCoAAAAAAADMm+1dIJGyqveKouiMPwNbF0Wx17XNewMLAAAAAAAA86bTB6RzbuwZwZnABwAAAAAAACyDTh+QQFnVR0VR/GnsGdhN1zYHBhUAAAAAAACWQacP2LKyqp8VRbEy7ozg1KACAAAAAADAcgh9wPb1C/O7xp2BXXRtc2VQAQAAAAAAYDls7wJbVFb1XlEUnTFnYOuiKPa6tnlvYAEAAAAAAGA5dPqA7To33ozgTOADAAAAAAAAlkenD9iSsqqPiqL403gzsJuubQ4MKgAAAAAAACyPTh+wBWVVPyuKYmWsGcGpQQUAAAAAAIBlEvqA7egX5neNNQO76NrmyqACAAAAAADAMtneBUZWVvVeURSdcWZg66Io9rq2eW9gAQAAAAAAYJl0+oDxnRtjRnAm8AEAAAAAAADLptMHjKis6qOiKP40xgzspmubA4MKAAAAAAAAy6bTB4ykrOpnRVGsjC8jODWoAAAAAAAAgNAHjKdfmN81vgzsomubK4MKAAAAAAAA2N4FRlBW9V5RFJ2xZWDroij2urZ5b2ABAAAAAAAAnT5gHOfGlRGcCXwAAAAAAAAAd3T6gIGVVX1UFMWfxpWB3XRtc2BQAQAAAAAAgDs6fcCAyqp+VhTFypgyglODCgAAAAAAAGwS+oBh9Qvzu8aUgV10bXNlUAEAAAAAAIBNtneBgZRVvVcURWc8Gdi6KIq9rm3eG1gAAAAAAABgk04fMJxzY8kIzgQ+AAAAAAAAgK/R6QMGUFb1UVEUfxpLBnbTtc2BQQUAAAAAAAC+RqcPeKKyqp8VRbEyjozg1KACAAAAAAAA3yL0AU/XL8zvGkcG9qZrmyuDCgAAAAAAAHyL7V3gCcqq3iuKojOGDGxdFMVB1zbvDCwAAAAAAADwLTp9wNOcGz9GcCbwAQAAAAAAAPyITh/wSGVVHxZF8ZfxY2DXXdscGlQAAAAAAADgR3T6gMc7MXYMrN/W5cigAgAAAAAAAPch9AGPZ3GeoR11bfPeqAIAAAAAAAD3IfQBj1BW9UFRFDvGjgG96trmyoACAAAAAAAA9yX0AY/zzLgxoIuubc4MKAAAAAAAAPAQQh/wOHvGjYFcd21zYjABAAAAAACAhxL6AEjnpiiKI+MPAAAAAAAAPIbQBzzOO+PGE/WBj8Oubd4bSAAAAAAAAOAxhD7gcSzU8xQXAh8AAAAAAADAU/304cMHgwiPUFa1k4fHuOja5sTIAQAAAAAAAP9/e3ds0zAYBgH0CnrYANy4cAUTsAIjwAaMABuwAbBB2CAjQOPCjcMGsAH6pSBRIASxTQJ+T/rl/tye7hvK0gds7kF2/NCFwgcAAAAAAAAwFqUP2NxCdnzTc5KTvmvvBAYAAAAAAACMxXkXGKCqm1WSQxnyhbIIc9537YuQAAAAAAAAgDHtSRMGuUpyK0I+UdY9LvuutQgDAAAAAAAATMLSBwxU1c0yyakc+eA6yY11DwAAAAAAAGBKlj5guLMk5czLvixn776sv/Rdu5p7EAAAAAAAAMD0LH3ACKq6OU6yVPyYLWUPAAAAAAAA4NcpfcBIFD9m5znJXXnKHgAAAAAAAMA2KH3AiKq6OUiySHIq13/pdf1/F33XLuYeBgAAAAAAALBdSh8wgapuzsu5jySH8v3zntYLLqXosZx7GAAAAAAAAMDuUPqACVV1c5bk/Tn7stvKisdjktX6+6jkAQAAAAAAAOwypQ/4JVXdHCU5kvfOKeWOl7mHAAAAAAAAAPwxSd4ANjf3QoCyBl4AAAAASUVORK5CYII=";

const CAR_BRANDS = ["Audi","BYD","BMW","Tesla","Volvo","MINI","MG","Mercedes Benz","KIA","MAXUS","Smart","Nissan","Lexus","Hyundai","Honda","Toyota","Porsche","Aion","Hyptec","XPeng","Volkswagen","IM Motors","Zeekr","Subaru","ORA","Wuling","Polestar","NETA","LOTUS","DENZA","Dongfeng","SERES","KGM","Deepal","JAECOO","其他-Other"];

const PRODUCTS_LIST = ["GBT轉CCS2 快充轉插","GBT轉CCS2 快充轉插 Pro","Magcar 3","GBT轉Type 2 中充轉插Pro","GBT轉Type 2 中充轉插","Type2 V2L 歐標放電裝置","Type 2 歐標充電線","Type2 歐標家用牆充"];

const REFERRAL_SOURCES = ["Facebook","Instagram","WhatsApp","Walk-in","Friend Referral","Shopify","Other"];

// ── ICONS ──────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    product: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
    inventory: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><path d="M9 12h6M9 16h4"/></svg>,
    customer: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    invoice: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>,
    warning: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>,
    print: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
    trend_up: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    car: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
    x: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  };
  return icons[name] || null;
};

const Badge = ({ status }) => {
  const map = {
    "In Stock": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Sold": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
    "Warranty Expiring": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "Expired": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Paid": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Unpaid": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Pending": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "VIP": { bg: "#f3e5f5", color: "#6a1b9a", dot: "#9c27b0" },
    "Regular": { bg: "#f5f5f5", color: "#424242", dot: "#9e9e9e" },
    "Lead": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
  };
  const s = map[status] || { bg: "#f5f5f5", color: "#333", dot: "#999" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />{status}
    </span>
  );
};

const StatCard = ({ label, value, sub, accent, icon }) => (
  <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: "16px 16px 0 0" }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 13, color: "#888", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.2, marginTop: 4 }}>{value}</div>
        {sub && <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>{icon}</div>
    </div>
  </div>
);

const Input = ({ label, value, onChange, placeholder, type = "text" }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
  </div>
);

const Select = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff" }}>
      <option value="">Select...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// ── INVOICE PDF PRINT ──────────────────────────────────────────────────────────
function printInvoice(inv, customer, items) {
  const rows = items.map((item, i) => `
    <tr>
      <td>${item.name || ""}</td>
      <td style="text-align:center">${item.qty || 1}</td>
      <td style="text-align:right">$${item.price || 0}</td>
      <td style="text-align:right">$${(item.qty || 1) * (item.price || 0)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #222; margin: 0; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
    .logo { height: 50px; }
    .tagline { font-size: 11px; color: #888; letter-spacing: 2px; text-align: right; margin-top: 6px; }
    h1 { font-size: 28px; letter-spacing: 6px; margin: 0 0 4px; }
    .meta { font-size: 13px; color: #555; margin-bottom: 30px; }
    .bill-row { display: flex; gap: 60px; margin-bottom: 30px; }
    .bill-col h3 { font-size: 12px; letter-spacing: 2px; color: #888; margin: 0 0 6px; }
    .bill-col p { margin: 2px 0; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #1a1a2e; color: #fff; padding: 12px 16px; text-align: left; font-size: 12px; letter-spacing: 1px; }
    td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .total-row { background: #1a1a2e; color: #fff; }
    .total-row td { font-size: 18px; font-weight: bold; padding: 16px; }
    .payment { margin-bottom: 30px; font-size: 13px; }
    .payment h3 { font-size: 12px; letter-spacing: 2px; color: #888; margin-bottom: 8px; }
    .footer { border-top: 1px solid #eee; padding-top: 20px; display: flex; justify-content: space-between; font-size: 12px; color: #666; }
    .note { margin-top: 20px; font-size: 11px; color: #888; }
    @media print { body { padding: 20px; } }
  </style></head><body>
  <div class="header">
    <div>
      <img src="data:image/png;base64,${LOGO_B64}" class="logo" />
    </div>
    <div style="text-align:right">
      <div class="tagline">SPECIALIST OF EV CHARGING</div>
      <h1>I N V O I C E</h1>
      <div style="font-size:16px;font-weight:bold;letter-spacing:2px"># DC${inv.invoice_number || inv.id}</div>
    </div>
  </div>
  <div class="meta">
    <strong>ISSUED:</strong> ${inv.date || new Date().toISOString().slice(0,10)}&nbsp;&nbsp;&nbsp;
    <strong>DUE ON RECEIPT</strong>
  </div>
  <div class="bill-row">
    <div class="bill-col">
      <h3>BILL TO</h3>
      <p><strong>${customer?.name || ""}</strong></p>
      <p>${customer?.email || ""}</p>
      <p>${customer?.phone || ""}</p>
      <p>${customer?.address || ""}</p>
    </div>
    <div class="bill-col">
      <h3>CAR DETAIL</h3>
      <p>${customer?.car_make || ""} ${customer?.car_model || ""}</p>
    </div>
  </div>
  <table>
    <thead><tr><th>D E S C R I P T I O N</th><th style="text-align:center">Q U A N T I T Y</th><th style="text-align:right">P R I C E</th><th style="text-align:right">T O T A L</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row"><td colspan="3">A M O U N T &nbsp; D U E : &nbsp; HKD$</td><td style="text-align:right">${inv.total || 0}</td></tr></tfoot>
  </table>
  <div class="payment">
    <h3>PAYMENT INFO 支付方法</h3>
    <p>FPS / Bank Transfer / PayMe</p>
  </div>
  <div class="footer">
    <div>
      <div><strong>Honnmono Intl Ltd</strong> &nbsp; +852 9575 7519</div>
      <div>Room 1516, 15/F, New Commerce Ctr, Shek Mun, Sha Tin, HK</div>
      <div>www.honnmono-store.com &nbsp; business@honn-mono-store.com</div>
    </div>
    <div style="text-align:right">
      <div>Honnmono &nbsp; Honnmono_international</div>
    </div>
  </div>
  <div class="note">GBT to CSS2 轉插提供為期2年的保修服務，並包含定期軟件升級服務。請密切留意Facebook和官方網站上相關消息的更新。</div>
  <div style="text-align:center;margin-top:30px;font-size:14px;letter-spacing:3px;color:#888">THANK YOU FOR YOUR BUSINESS !</div>
  </body></html>`;

  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceGenerated, setInvoiceGenerated] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newCustomer, setNewCustomer] = useState({
    name: "", email: "", phone: "", phone_mainland: "",
    car_make: "", car_model: "", address: "",
    interest_products: [], referral: "", type: "Lead", notes: ""
  });

  const [newInvoice, setNewInvoice] = useState({
    customerId: "", items: [{ name: "", qty: 1, price: 0 }], notes: "", warranty: false
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [p, i, c, inv] = await Promise.all([
        supabase.from("products").select("*").order("name"),
        supabase.from("inventory").select("*"),
        supabase.from("customers").select("*").order("name"),
        supabase.from("invoices").select("*").order("date", { ascending: false }),
      ]);
      if (p.data) setProducts(p.data);
      if (i.data) setInventory(i.data);
      if (c.data) setCustomers(c.data);
      if (inv.data) setInvoices(inv.data);
      setLoading(false);
    }
    load();
  }, []);

  const getProduct = (id) => products.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);
  const warrantyAlerts = inventory.filter(i => i.status === "Warranty Expiring");
  const totalRevenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const inStock = inventory.filter(i => i.status === "In Stock").length;

  const invoiceTotal = newInvoice.items.reduce((sum, item) => sum + (item.price * item.qty || 0), 0);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "inventory", label: "Inventory", icon: "inventory" },
    { id: "products", label: "Products", icon: "product" },
    { id: "customers", label: "Customers", icon: "customer" },
    { id: "invoices", label: "Invoices", icon: "invoice" },
  ];

  async function handleSaveCustomer() {
    setSaving(true);
    const { data, error } = await supabase.from("customers").insert([{
      name: newCustomer.name,
      email: newCustomer.email,
      phone: newCustomer.phone,
      phone_mainland: newCustomer.phone_mainland,
      car_make: newCustomer.car_make,
      car_model: newCustomer.car_model,
      address: newCustomer.address,
      interest_products: newCustomer.interest_products,
      referral: newCustomer.referral,
      type: newCustomer.type || "Lead",
      notes: newCustomer.notes,
    }]).select();
    if (!error && data) {
      setCustomers(prev => [...prev, ...data]);
      setShowAddCustomer(false);
      setNewCustomer({ name: "", email: "", phone: "", phone_mainland: "", car_make: "", car_model: "", address: "", interest_products: [], referral: "", type: "Lead", notes: "" });
    }
    setSaving(false);
  }

  async function handleGenerateInvoice() {
    setSaving(true);
    const invNumber = `${Date.now()}`.slice(-6);
    const { data, error } = await supabase.from("invoices").insert([{
      invoice_number: invNumber,
      customer_id: newInvoice.customerId || null,
      date: new Date().toISOString().slice(0, 10),
      items: newInvoice.items,
      total: invoiceTotal,
      status: "Unpaid",
      notes: newInvoice.notes,
    }]).select();
    if (!error && data) {
      setInvoices(prev => [data[0], ...prev]);
      setInvoiceGenerated(true);
      const customer = getCustomer(newInvoice.customerId);
      printInvoice(data[0], customer, newInvoice.items);
      setTimeout(() => {
        setInvoiceGenerated(false);
        setShowNewInvoice(false);
        setNewInvoice({ customerId: "", items: [{ name: "", qty: 1, price: 0 }], notes: "", warranty: false });
      }, 2000);
    }
    setSaving(false);
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, background: "#f7f8fc" }}>
      <div style={{ width: 48, height: 48, border: "4px solid #e0e0e0", borderTopColor: "#6382ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ color: "#888", fontSize: 15 }}>Loading BizFlow...</div>
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", background: "#f7f8fc", color: "#1a1a2e" }}>

      {/* SIDEBAR */}
      <aside style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <img src={`data:image/png;base64,${LOGO_B64}`} style={{ width: "100%", maxHeight: 36, objectFit: "contain", filter: "invert(1)" }} />
          <div style={{ fontSize: 10, color: "#6b7bb8", marginTop: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>Business Suite</div>
        </div>
        {warrantyAlerts.length > 0 && (
          <div style={{ margin: "10px 12px", background: "#ff9800", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="warning" size={13} />
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{warrantyAlerts.length} warranty expiring</div>
          </div>
        )}
        <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => { setTab(n.id); setSelectedCustomer(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: tab === n.id ? "rgba(99,130,255,0.18)" : "transparent", color: tab === n.id ? "#7c9dff" : "#8899cc", fontSize: 14, fontWeight: tab === n.id ? 700 : 500, textAlign: "left" }}>
              <Icon name={n.icon} size={17} />{n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "14px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(99,130,255,0.1)", borderRadius: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7c9dff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>H</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Honnmono</div>
              <div style={{ fontSize: 11, color: "#6b7bb8" }}>Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, overflow: "auto", padding: "32px 36px" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Good morning 👋</h1>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 15 }}>Here's what's happening with Honnmono today.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
              <StatCard label="Total Revenue" value={`HKD$${totalRevenue.toLocaleString()}`} sub="All invoices" accent="#6382ff" icon={<Icon name="trend_up" size={20} />} />
              <StatCard label="Units In Stock" value={inStock} sub={`of ${inventory.length} total`} accent="#22c55e" icon={<Icon name="inventory" size={20} />} />
              <StatCard label="Customers" value={customers.length} sub="All time" accent="#f59e0b" icon={<Icon name="customer" size={20} />} />
              <StatCard label="Warranty Alerts" value={warrantyAlerts.length} sub="Need follow-up" accent="#ef4444" icon={<Icon name="warning" size={20} />} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent Invoices</h2>
                  <button onClick={() => setTab("invoices")} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>View all →</button>
                </div>
                {invoices.slice(0, 5).map(inv => {
                  const c = getCustomer(inv.customer_id);
                  return (
                    <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>DC{inv.invoice_number || inv.id}</div>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{c?.name || "—"} · {inv.date}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>HKD${inv.total}</span>
                        <Badge status={inv.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔔 Warranty Alerts</h2>
                  <Badge status="Warranty Expiring" />
                </div>
                {warrantyAlerts.length === 0 ? (
                  <div style={{ color: "#aaa", fontSize: 14, textAlign: "center", paddingTop: 20 }}>No alerts right now ✓</div>
                ) : warrantyAlerts.slice(0, 5).map(item => {
                  const p = getProduct(item.product_id);
                  const c = getCustomer(item.customer_id);
                  return (
                    <div key={item.id} style={{ background: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p?.name}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>SN: {item.serial_no} · {c?.name}</div>
                      <div style={{ fontSize: 12, color: "#e65100", marginTop: 4, fontWeight: 600 }}>Warranty ends: {item.warranty_end}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* INVENTORY */}
        {tab === "inventory" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Inventory</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>Track every unit — serial number, warranty, customer</p>
              </div>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f5f5f5" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f7f8fc", borderRadius: 8, padding: "8px 14px" }}>
                  <Icon name="search" size={15} />
                  <input placeholder="Search serial number, product, customer..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    {["Serial No.", "Product", "Status", "Customer", "Sold Date", "Warranty End", "Extended"].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#888", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid #f0f0f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventory.filter(i => {
                    const p = getProduct(i.product_id);
                    const c = getCustomer(i.customer_id);
                    const q = search.toLowerCase();
                    return !q || (i.serial_no || "").toLowerCase().includes(q) || (p?.name || "").toLowerCase().includes(q) || (c?.name || "").toLowerCase().includes(q);
                  }).map((item, idx) => {
                    const p = getProduct(item.product_id);
                    const c = getCustomer(item.customer_id);
                    return (
                      <tr key={item.id} style={{ borderBottom: "1px solid #f5f5f5", background: idx % 2 === 0 ? "#fff" : "#fafbff" }}>
                        <td style={{ padding: "12px 16px", fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#6382ff" }}>{item.serial_no || "—"}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 600 }}>{p?.name || item.product_id}</td>
                        <td style={{ padding: "12px 16px" }}><Badge status={item.status} /></td>
                        <td style={{ padding: "12px 16px", color: c ? "#333" : "#ccc" }}>{c?.name || "—"}</td>
                        <td style={{ padding: "12px 16px", color: "#666" }}>{item.sold_date || "—"}</td>
                        <td style={{ padding: "12px 16px", color: item.status === "Warranty Expiring" ? "#e65100" : "#666" }}>{item.extended ? item.extended_end : (item.warranty_end || "—")}</td>
                        <td style={{ padding: "12px 16px" }}>{item.extended ? <span style={{ color: "#22c55e", fontWeight: 700, fontSize: 12 }}>✓ Extended</span> : <span style={{ color: "#ccc" }}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PRODUCTS */}
        {tab === "products" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Products</h1>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>Synced from Shopify — your product catalogue</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
              {products.map(p => {
                const units = inventory.filter(i => i.product_id === p.id);
                const sold = units.filter(i => i.status === "Sold").length;
                const instock = units.filter(i => i.status === "In Stock").length;
                return (
                  <div key={p.id} style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#aaa", marginBottom: 4 }}>{p.code || p.id}</div>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>{p.name}</div>
                        <div style={{ fontSize: 13, color: "#888", marginTop: 3 }}>{p.category}</div>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#6382ff" }}>HKD${p.price}</div>
                    </div>
                    {p.specs && <div style={{ background: "#f7f8fc", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#555" }}>📋 {p.specs}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      {[
                        { label: "In Stock", value: p.stock ?? instock, color: "#22c55e" },
                        { label: "Sold", value: sold, color: "#6382ff" },
                        { label: "Warranty", value: `${p.warranty_months || "—"}mo`, color: "#f59e0b" },
                      ].map(stat => (
                        <div key={stat.label} style={{ textAlign: "center", padding: "10px 8px", background: stat.color + "12", borderRadius: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{stat.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CUSTOMERS */}
        {tab === "customers" && !selectedCustomer && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Customers</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{customers.length} total customers</p>
              </div>
              <button onClick={() => setShowAddCustomer(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> Add Customer
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="search" size={15} />
              <input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {customers.filter(c => {
                const q = search.toLowerCase();
                return !q || (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (c.phone || "").includes(q);
              }).map(c => {
                const custInvoices = invoices.filter(i => i.customer_id === c.id);
                const total = custInvoices.reduce((s, i) => s + (i.total || 0), 0);
                return (
                  <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 18, cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#6382ff"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#f0f0f0"}>
                    <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                      {(c.name || "?")[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                        <span style={{ fontSize: 16, fontWeight: 800 }}>{c.name}</span>
                        <Badge status={c.type || "Regular"} />
                      </div>
                      <div style={{ fontSize: 13, color: "#666" }}>{c.email} · {c.phone}</div>
                      {c.car_make && <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>🚗 {c.car_make} {c.car_model}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 12, textAlign: "center" }}>
                      <div style={{ padding: "8px 14px", background: "#f0f4ff", borderRadius: 10 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#6382ff" }}>HKD${total.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>Lifetime</div>
                      </div>
                      <div style={{ padding: "8px 14px", background: "#fff8f0", borderRadius: 10 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>{custInvoices.length}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>Orders</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CUSTOMER PROFILE */}
        {tab === "customers" && selectedCustomer && (
          <div>
            <button onClick={() => setSelectedCustomer(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#6382ff", fontWeight: 700, fontSize: 14, marginBottom: 20, padding: 0 }}>
              <Icon name="back" size={16} /> Back to Customers
            </button>
            <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                  {(selectedCustomer.name || "?")[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{selectedCustomer.name}</h2>
                    <Badge status={selectedCustomer.type || "Regular"} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
                    {selectedCustomer.email && <div>📧 {selectedCustomer.email}</div>}
                    {selectedCustomer.phone && <div>📱 HK: {selectedCustomer.phone}</div>}
                    {selectedCustomer.phone_mainland && <div>📱 Mainland: {selectedCustomer.phone_mainland}</div>}
                    {selectedCustomer.address && <div>📍 {selectedCustomer.address}</div>}
                    {selectedCustomer.car_make && <div>🚗 {selectedCustomer.car_make} {selectedCustomer.car_model}</div>}
                    {selectedCustomer.referral && <div>🔗 Referral: {selectedCustomer.referral}</div>}
                  </div>
                  {selectedCustomer.interest_products?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <span style={{ fontSize: 13, color: "#888" }}>Interested in: </span>
                      {selectedCustomer.interest_products.map(p => (
                        <span key={p} style={{ background: "#f0f4ff", color: "#6382ff", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600, marginRight: 6 }}>{p}</span>
                      ))}
                    </div>
                  )}
                  {selectedCustomer.notes && <div style={{ marginTop: 10, fontSize: 13, color: "#888", background: "#f9f9f9", borderRadius: 8, padding: "8px 12px" }}>📝 {selectedCustomer.notes}</div>}
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Purchase History</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {invoices.filter(i => i.customer_id === selectedCustomer.id).length === 0 ? (
                <div style={{ background: "#fff", borderRadius: 14, padding: 24, textAlign: "center", color: "#aaa", border: "1px solid #f0f0f0" }}>No purchases yet</div>
              ) : invoices.filter(i => i.customer_id === selectedCustomer.id).map(inv => (
                <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>DC{inv.invoice_number || inv.id}</div>
                    <div style={{ fontSize: 13, color: "#888", marginTop: 3 }}>{inv.date} · {inv.notes}</div>
                    {Array.isArray(inv.items) && inv.items.map((item, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{item.name} ×{item.qty} — HKD${item.price}</div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${inv.total}</div>
                    <Badge status={inv.status} />
                    <button onClick={() => printInvoice(inv, selectedCustomer, inv.items || [])} style={{ fontSize: 12, background: "#f0f4ff", color: "#6382ff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon name="print" size={13} /> Print
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* INVOICES */}
        {tab === "invoices" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Invoices</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{invoices.length} total invoices</p>
              </div>
              <button onClick={() => setShowNewInvoice(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> New Invoice
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="search" size={15} />
              <input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {invoices.filter(inv => {
                const c = getCustomer(inv.customer_id);
                const q = search.toLowerCase();
                return !q || (inv.invoice_number || "").includes(q) || (c?.name || "").toLowerCase().includes(q);
              }).map(inv => {
                const c = getCustomer(inv.customer_id);
                return (
                  <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 18 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>DC{inv.invoice_number || inv.id}</div>
                      <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{c?.name || "—"} · {inv.date} · {inv.notes}</div>
                      {Array.isArray(inv.items) && inv.items.slice(0, 2).map((item, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#999" }}>{item.name} ×{item.qty}</div>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${inv.total}</div>
                      <Badge status={inv.status} />
                      <button onClick={() => printInvoice(inv, c, inv.items || [])} style={{ fontSize: 12, background: "#f0f4ff", color: "#6382ff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        <Icon name="print" size={13} /> Print
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* ADD CUSTOMER MODAL */}
      {showAddCustomer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 580, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Add Customer</h2>
              <button onClick={() => setShowAddCustomer(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
              <Input label="中文名 / Name *" value={newCustomer.name} onChange={v => setNewCustomer({...newCustomer, name: v})} placeholder="客戶名稱" />
              <Input label="Email" value={newCustomer.email} onChange={v => setNewCustomer({...newCustomer, email: v})} placeholder="email@example.com" />
              <Input label="香港電話" value={newCustomer.phone} onChange={v => setNewCustomer({...newCustomer, phone: v})} placeholder="+852" />
              <Input label="內地電話" value={newCustomer.phone_mainland} onChange={v => setNewCustomer({...newCustomer, phone_mainland: v})} placeholder="+86" />
              <Select label="汽車品牌 Car Brand" value={newCustomer.car_make} onChange={v => setNewCustomer({...newCustomer, car_make: v})} options={CAR_BRANDS} />
              <Input label="型號 Car Model" value={newCustomer.car_model} onChange={v => setNewCustomer({...newCustomer, car_model: v})} placeholder="e.g. Model 3, Han EV" />
              <Select label="Status" value={newCustomer.type} onChange={v => setNewCustomer({...newCustomer, type: v})} options={["Lead","Regular","VIP"]} />
              <Select label="Referral Source" value={newCustomer.referral} onChange={v => setNewCustomer({...newCustomer, referral: v})} options={REFERRAL_SOURCES} />
            </div>
            <Input label="地址 Address" value={newCustomer.address} onChange={v => setNewCustomer({...newCustomer, address: v})} placeholder="Full address" />
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>有興趣產品 Interested Products</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PRODUCTS_LIST.map(p => (
                  <label key={p} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: newCustomer.interest_products.includes(p) ? "#e8edff" : "#f5f5f5", borderRadius: 20, cursor: "pointer", fontSize: 13, border: newCustomer.interest_products.includes(p) ? "1px solid #6382ff" : "1px solid transparent", color: newCustomer.interest_products.includes(p) ? "#6382ff" : "#555", fontWeight: newCustomer.interest_products.includes(p) ? 700 : 400 }}>
                    <input type="checkbox" checked={newCustomer.interest_products.includes(p)} onChange={e => {
                      const list = e.target.checked ? [...newCustomer.interest_products, p] : newCustomer.interest_products.filter(x => x !== p);
                      setNewCustomer({...newCustomer, interest_products: list});
                    }} style={{ display: "none" }} />{p}
                  </label>
                ))}
              </div>
            </div>
            <Input label="Notes" value={newCustomer.notes} onChange={v => setNewCustomer({...newCustomer, notes: v})} placeholder="Any additional notes..." />
            <button onClick={handleSaveCustomer} disabled={!newCustomer.name || saving} style={{ width: "100%", padding: 14, background: newCustomer.name ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: newCustomer.name ? "pointer" : "not-allowed" }}>
              {saving ? "Saving..." : "Save Customer"}
            </button>
          </div>
        </div>
      )}

      {/* NEW INVOICE MODAL */}
      {showNewInvoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 560, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            {invoiceGenerated ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e8f5e9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#22c55e" }}><Icon name="check" size={36} /></div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>Invoice Generated!</div>
                <div style={{ color: "#888", marginTop: 8, fontSize: 14 }}>PDF printed & saved to database</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>New Invoice</h2>
                  <button onClick={() => setShowNewInvoice(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>Customer</label>
                  <select value={newInvoice.customerId} onChange={e => setNewInvoice({...newInvoice, customerId: e.target.value})} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff" }}>
                    <option value="">Select customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `· ${c.phone}` : ""}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>Items</label>
                  {newInvoice.items.map((item, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 0.5fr 0.8fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                      <input value={item.name} onChange={e => { const items = [...newInvoice.items]; items[idx].name = e.target.value; setNewInvoice({...newInvoice, items}); }} placeholder="Product / Service" style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                      <input type="number" min="1" value={item.qty} onChange={e => { const items = [...newInvoice.items]; items[idx].qty = parseInt(e.target.value) || 1; setNewInvoice({...newInvoice, items}); }} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "center" }} />
                      <input type="number" value={item.price} onChange={e => { const items = [...newInvoice.items]; items[idx].price = parseFloat(e.target.value) || 0; setNewInvoice({...newInvoice, items}); }} placeholder="Price" style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                      <button onClick={() => { const items = newInvoice.items.filter((_, i) => i !== idx); setNewInvoice({...newInvoice, items: items.length ? items : [{ name: "", qty: 1, price: 0 }]}); }} style={{ background: "#fce4ec", border: "none", borderRadius: 8, padding: "9px 10px", cursor: "pointer", color: "#e53935" }}><Icon name="x" size={13} /></button>
                    </div>
                  ))}
                  <button onClick={() => setNewInvoice({...newInvoice, items: [...newInvoice.items, { name: "", qty: 1, price: 0 }]})} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", width: "100%" }}>+ Add item</button>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>Notes</label>
                  <input value={newInvoice.notes} onChange={e => setNewInvoice({...newInvoice, notes: e.target.value})} placeholder="e.g. Shopify Order #1055, WhatsApp order..." style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f0f4ff", borderRadius: 12, marginBottom: 20 }}>
                  <input type="checkbox" id="warranty" checked={newInvoice.warranty} onChange={e => setNewInvoice({...newInvoice, warranty: e.target.checked})} style={{ width: 16, height: 16, cursor: "pointer" }} />
                  <label htmlFor="warranty" style={{ fontSize: 14, cursor: "pointer", fontWeight: 600 }}>Customer wants extended warranty (+1 year)</label>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", background: "#1a1a2e", borderRadius: 12, marginBottom: 16 }}>
                  <span style={{ color: "#aaa", fontSize: 14 }}>Total</span>
                  <span style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>HKD${invoiceTotal.toLocaleString()}</span>
                </div>
                <button onClick={handleGenerateInvoice} disabled={invoiceTotal === 0 || saving} style={{ width: "100%", padding: 14, background: invoiceTotal > 0 ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: invoiceTotal > 0 ? "pointer" : "not-allowed" }}>
                  {saving ? "Generating..." : "Generate Invoice & Print PDF"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
